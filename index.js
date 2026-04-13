import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import os from "os";
import multer from "multer";
import { v2 as cloudinary } from 'cloudinary';
import { sendTicketEmail, sendWelcomeEmail, sendGenericEmail } from './utils/mailer.js';
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 5000;

// ✅ Production readiness
const isProduction = process.env.NODE_ENV === 'production';

// ✅ Multer configuration for file attachments
const uploadDir = path.join(os.tmpdir(), 'hitam-uploads');
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Ensure uploads directory exists in transient storage
try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (err) {
  console.warn('⚠️ Could not create transient upload directory:', err.message);
}

// ✅ CORS: Allow both development and production origins
const corsOptions = {
  origin: (origin, callback) => {
    // Allow these origins
    const allowedOrigins = [
      'http://localhost:5173',           // Local frontend (Vite dev server)
      'http://localhost:3000',           // Alternative local port
      'https://hitam-ai-club.vercel.app', // Production frontend
      process.env.FRONTEND_URL,           // Env var for production
    ].filter(Boolean);

    // Allow requests with no origin (mobile apps, curl requests)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
  optionsSuccessStatus: 200
};

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dwva5ae36',
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ✅ In-Memory Cache to prevent Rate Limiting
const cache = {
  data: new Map(),
  ttl: 5 * 60 * 1000, // 5 minutes default TTL
};

const getFromCache = (key) => {
  if (cache.data.has(key)) {
    const { value, expiry } = cache.data.get(key);
    if (Date.now() < expiry) {
      console.log(`⚡ Serving from cache: ${key}`);
      return value;
    }
    cache.data.delete(key); // Expired
  }
  return null;
};

const setCache = (key, value, ttl = cache.ttl) => {
  cache.data.set(key, {
    value,
    expiry: Date.now() + ttl
  });
};

const clearCache = () => {
  console.log('🧹 Clearing Cloudinary cache');
  cache.data.clear();
};

// Helper function to map Cloudinary folders to UI folders
const mapFolderToUI = (publicId) => {
  const pathParts = publicId.split('/');
  let folderName = 'general';

  if (pathParts.length > 1) {
    const cloudinaryFolder = pathParts[1];
    switch (cloudinaryFolder) {
      case 'committee_members':
        folderName = 'commitymembers';
        break;
      case 'events':
      case 'upcoming_events':
        folderName = 'events';
        break;
      case 'form_register':
      case 'form_builder':
        folderName = 'formregister';
        break;
      case 'user_profiles':
      case 'community_members':
        folderName = 'profiles';
        break;
      case 'general':
        folderName = 'general';
        break;
      default:
        folderName = 'general';
    }
  }

  return folderName;
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Clean Root route

// Root route
app.get("/", (req, res) => {
  res.send("HITAM AI API is running");
});

// Article Image Proxy — follows redirects, extracts real og:image
app.get("/api/article-image", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.json({ image: null });

  const cacheKey = `article_img_${url}`;
  const cached = getFromCache(cacheKey);
  if (cached) return res.json(cached);

  // Domains that show their own logo instead of article image — always reject
  const BLOCKED_IMAGE_DOMAINS = [
    'news.google.com', 'google.com', 'gstatic.com',
    'msn.com', 'bing.com', 'microsoft.com',
    'facebook.com', 'fbcdn.net',
    'apple.com', 'icloud.com'
  ];

  const isBlockedImage = (imgUrl) => {
    try {
      const domain = new URL(imgUrl).hostname.replace('www.', '');
      return BLOCKED_IMAGE_DOMAINS.some(d => domain.includes(d));
    } catch { return true; }
  };

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      signal: AbortSignal.timeout(6000)
    });

    // If the redirect ended up back on Google/MSN, no real image available
    const finalUrl = response.url || url;
    if (isBlockedImage(finalUrl) || finalUrl.includes('news.google.com') || finalUrl.includes('msn.com')) {
      const result = { image: null };
      setCache(cacheKey, result, 6 * 60 * 60 * 1000); // cache null for 6h
      return res.json(result);
    }

    const html = await response.text();

    // Extract image in priority order
    const rawImage =
      html.match(/<meta[^>]*property=["']og:image:secure_url["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
      html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i)?.[1] ||
      html.match(/<meta[^>]*name=["']twitter:image:src["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
      html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i)?.[1] ||
      null;

    const isValid = rawImage && rawImage.startsWith('http') && !isBlockedImage(rawImage);
    const result = { image: isValid ? rawImage : null };
    setCache(cacheKey, result, 24 * 60 * 60 * 1000);
    res.json(result);
  } catch (err) {
    res.json({ image: null });
  }
});

// AI News Proxy Endpoint
app.get("/api/ai-news", async (req, res) => {
  try {
    console.log("📰 Incoming Intelligent News Request");
    const cacheKey = 'ai_news_intelligence_v13';
    const cached = getFromCache(cacheKey);
    if (cached) return res.json(cached);

    // === MULTI-FEED PARALLEL FETCH (Live last 24h — AI & Tech only) ===
    const RSS_FEEDS = [
      // Core AI models, tools, and research (Global)
      `https://news.google.com/rss/search?q=${encodeURIComponent('("AI" OR "LLM" OR "ChatGPT" OR "Claude" OR "Gemini" OR "Llama") (model OR tool OR launch OR update) when:1d')}&hl=en&gl=US&ceid=US:en`,
      // AI startups and funding (Global)
      `https://news.google.com/rss/search?q=${encodeURIComponent('("AI startup" OR "AI funding" OR "AI company" OR "machine learning" OR "generative AI") when:1d')}&hl=en&gl=US&ceid=US:en`,
      // Visual AI tools (Global)
      `https://news.google.com/rss/search?q=${encodeURIComponent('("Sora" OR "Midjourney" OR "Runway" OR "Flux" OR "DALL-E" OR "Kling" OR "image generation" OR "video generation") when:1d')}&hl=en&gl=US&ceid=US:en`,
      // India AI & Technology — dedicated feed 1
      `https://news.google.com/rss/search?q=${encodeURIComponent('("AI" OR "artificial intelligence" OR "machine learning") India when:1d')}&hl=en-IN&gl=IN&ceid=IN:en`,
      // India AI & Technology — dedicated feed 2 (startups, tech companies)
      `https://news.google.com/rss/search?q=${encodeURIComponent('("tech startup" OR "AI startup" OR "technology" OR "deep tech") India ("crore" OR "funding" OR "launch" OR "product") when:1d')}&hl=en-IN&gl=IN&ceid=IN:en`,
      // India big tech & enterprise AI
      `https://news.google.com/rss/search?q=${encodeURIComponent('(Infosys OR TCS OR Wipro OR "IIT" OR ISRO OR Reliance) (AI OR technology OR "artificial intelligence") when:1d')}&hl=en-IN&gl=IN&ceid=IN:en`
    ];

    const feedResults = await Promise.allSettled(RSS_FEEDS.map(url => fetch(url).then(r => r.text())));
    const xml = feedResults
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value)
      .join('\n');

    // 1. Keyword Definitions
    const FILTERS = {
      // MUST contain at least one of these — strict AI/Tech gate
      MUST_INCLUDE: /\bAI\b|artificial intelligence|machine learning|deep learning|neural network|LLM|GPT|ChatGPT|Claude|Gemini|Llama|Mistral|Falcon|tech startup|generative|diffusion|transformer|automation|robotics|semiconductor|algorithm|data science|computer vision/i,

      // Noise removal — anything not AI/Tech (expanded to block religious/lifestyle junk)
      EXCLUDE: /\bpolitics\b|\belection\b|crime|murder|shooting|drug|movie|bollywood|hollywood|celebrity|\bsports\b|cricket|football|\bweather\b|flood|earthquake|accident|\bdeath\b|obituary|stock market|forex|recipe|fashion|beauty|horoscope|astrology|religion|temple|church|mosque|\beid\b|\bfestival\b|covid|vaccine|hospital|diet|nutrition|jesus|god|bible|blasphemous|prayer|spiritual|devotional|sermon|pastor|priest|worship|faith|hindu|muslim|christian|church/i,

      // High-value content signals — viral/trending material
      VIRAL: /launch|launched|releases|released|reveal|unveiled|introduces|new|update|version|announces|breakthrough|achieves|surpasses|beats|raises|funding|acquires|partnership|open.source|open-source/i,

      TECH_BRANDS: {
        'Google': /google|alphabet|gemini|gemma|deepmind/i,
        'Microsoft': /microsoft|azure|copilot|bing/i,
        'Meta': /\bmeta\b|facebook|llama|instagram/i,
        'Amazon': /amazon|aws|bedrock/i,
        'OpenAI': /openai|chatgpt|sora|dall-e|gpt-4|gpt-5/i,
        'Anthropic': /anthropic|claude/i,
        'Nvidia': /nvidia|h100|b200|cuda/i,
        'Apple': /apple|iphone|apple intelligence/i,
        'Hugging Face': /hugging face|huggingface/i,
        'Mistral': /mistral/i
      },

      // India tech filter — only include if also about AI/Tech
      INDIA_TECH: /india|indian|bangalore|bengaluru|hyderabad|mumbai|delhi|chennai|iit|isro|infosys|tcs|wipro|startup india|nasscom/i,

      TOOLS:    /\btool\b|\bapp\b|platform|software|api|sdk|plugin|extension/i,
      STARTUPS: /startup|funding|raised|series [abc]|seed round|vc|venture|acquired|acquisition|valued/i,
      MODELS:   /\bmodel\b|llm|gpt|claude|gemini|llama|mistral|falcon|stable diffusion|flux|inference|benchmark|parameter/i,
      VISUAL:   /sora|midjourney|dall-e|runway|pika|kling|image gen|video gen|stable diffusion|flux|gen-3|visual ai/i,
      TRAINING: /training|fine.tuning|\bgpu\b|h100|b200|dataset|pre.training|compute|supercomputer|cluster/i,
      APPS:     /ai agent|\bagent\b|autonomous|copilot|assistant|chatbot/i,
      AUDIO:    /suno|udio|music ai|audio gen|elevenlabs|whisper|text.to.speech/i
    };

    // === RICH IMAGE POOL (keyword-matched, never static) ===
    const AI_VISUALS = {
      // Video & Visual AI
      video:      "https://images.unsplash.com/photo-1536240478700-b869070f9279?q=80&w=1200",
      sora:       "https://images.unsplash.com/photo-1684391791792-cf810ec42e3c?q=80&w=1200",
      image_gen:  "https://images.unsplash.com/photo-1686191128892-cd7a56f76cf1?q=80&w=1200",
      // LLMs & Chatbots
      gpt:        "https://images.unsplash.com/photo-1677442136019-21780ecad995?q=80&w=1200",
      llm:        "https://images.unsplash.com/photo-1680446260103-b28c2c13edfa?q=80&w=1200",
      chatbot:    "https://images.unsplash.com/photo-1655720828018-edd2daec9349?q=80&w=1200",
      // Hardware & Chips
      nvidia:     "https://images.unsplash.com/photo-1591799264318-7e6ef8ddb7ea?q=80&w=1200",
      chips:      "https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=1200",
      // Robotics & Automation
      robot:      "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?q=80&w=1200",
      // Code & Dev
      code:       "https://images.unsplash.com/photo-1555066931-4365d14bab8c?q=80&w=1200",
      // Startups & Funding
      startup:    "https://images.unsplash.com/photo-1559136555-9303baea8ebd?q=80&w=1200",
      funding:    "https://images.unsplash.com/photo-1579621970795-87facc2f976d?q=80&w=1200",
      // Security
      security:   "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=80&w=1200",
      // India tech
      india_tech: "https://images.unsplash.com/photo-1532375810709-75b1da00537c?q=80&w=1200",
      india_ai:   "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?q=80&w=1200",
      // Network & Data
      network:    "https://images.unsplash.com/photo-1509062522246-3755977927d7?q=80&w=1200",
      data:       "https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=1200",
      // Music/Audio AI
      audio:      "https://images.unsplash.com/photo-1511379938547-c1f69419868d?q=80&w=1200",
      // Default AI brain
      default:    "https://images.unsplash.com/photo-1620712943543-bcc4628c6733?q=80&w=1200"
    };

    // Extract real image URL from RSS item (media:content, enclosure, or og:image in description)
    const extractRssImage = (itemContent, description) => {
      // Try media:content url
      const mediaMatch = itemContent.match(/media:content[^>]*url=["']([^"']+)["']/i)
                      || itemContent.match(/media:content[^>]*><media:thumbnail[^>]*url=["']([^"']+)["']/i)
                      || itemContent.match(/<enclosure[^>]*url=["']([^"']+)["']/i)
                      || itemContent.match(/<media:thumbnail[^>]*url=["']([^"']+)["']/i);
      if (mediaMatch) return mediaMatch[1];
      // Try og:image inside description HTML
      const ogMatch = description.match(/src=["']([^"']+\.(jpg|jpeg|png|webp))["']/i);
      if (ogMatch) return ogMatch[1];
      return null;
    };

    const getRelevantImage = (title, isIndia = false) => {
      const l = title.toLowerCase();
      // India-specific first
      if (isIndia && (l.includes('india') || l.includes('indian') || l.includes('bangalore') || l.includes('iit') || l.includes('isro'))) {
        if (l.includes('startup') || l.includes('funding')) return AI_VISUALS.funding;
        return AI_VISUALS.india_ai;
      }
      // Visual AI
      if (l.includes('sora') || l.includes('openai video')) return AI_VISUALS.sora;
      if (l.includes('video') || l.includes('runway') || l.includes('kling')) return AI_VISUALS.video;
      if (l.includes('image gen') || l.includes('midjourney') || l.includes('dall-e') || l.includes('flux') || l.includes('stable diffusion')) return AI_VISUALS.image_gen;
      // LLMs & chatbots
      if (l.includes('gpt') || l.includes('openai') || l.includes('chatgpt')) return AI_VISUALS.gpt;
      if (l.includes('llm') || l.includes('llama') || l.includes('mistral') || l.includes('claude') || l.includes('gemini')) return AI_VISUALS.llm;
      if (l.includes('chatbot') || l.includes('assistant') || l.includes('copilot')) return AI_VISUALS.chatbot;
      // Hardware
      if (l.includes('nvidia') || l.includes('h100') || l.includes('b200') || l.includes('cuda')) return AI_VISUALS.nvidia;
      if (l.includes('chip') || l.includes('semiconductor') || l.includes('hardware')) return AI_VISUALS.chips;
      // Robotics
      if (l.includes('robot') || l.includes('automation') || l.includes('tesla')) return AI_VISUALS.robot;
      // Code
      if (l.includes('code') || l.includes('developer') || l.includes('software') || l.includes('api') || l.includes('sdk')) return AI_VISUALS.code;
      // Security
      if (l.includes('security') || l.includes('safe') || l.includes('cyber')) return AI_VISUALS.security;
      // Startups & funding
      if (l.includes('funding') || l.includes('raised') || l.includes('series')) return AI_VISUALS.funding;
      if (l.includes('startup') || l.includes('invest')) return AI_VISUALS.startup;
      // Data & Network
      if (l.includes('data') || l.includes('dataset')) return AI_VISUALS.data;
      if (l.includes('network') || l.includes('cloud')) return AI_VISUALS.network;
      // Audio
      if (l.includes('audio') || l.includes('music') || l.includes('voice') || l.includes('speech')) return AI_VISUALS.audio;
      return AI_VISUALS.default;
    };

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemContent = match[1];
      const title = itemContent.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "";
      const link = itemContent.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
      const pubDate = itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "";
      const source = itemContent.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || "";
      const description = itemContent.match(/<description>([\s\S]*?)<\/description>/)?.[1] || "";

      const cleanTitle = title.replace(/ - [^-]+$/, "");

      // --- STRICT 24-HOUR DATE FILTER ---
      if (pubDate) {
        const articleDate = new Date(pubDate);
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        if (articleDate < cutoff) continue; // Skip articles older than 24 hours
      }

      // --- GATE 1: Must be AI/Tech content ---
      if (!FILTERS.MUST_INCLUDE.test(cleanTitle) && !FILTERS.MUST_INCLUDE.test(description.slice(0, 200))) continue;

      // --- GATE 2: Exclude all noise ---
      if (FILTERS.EXCLUDE.test(cleanTitle)) continue;

      // --- GATE 3: Must have a viral/value signal, OR be India AI/Tech ---
      const isIndiaTech = FILTERS.INDIA_TECH.test(cleanTitle) || FILTERS.INDIA_TECH.test(source);
      // For India stories: require AI/Tech but allow through if it's from an India source (Gate 3 relaxed)
      if (isIndiaTech) {
        // Still block if it also passes EXCLUDE
        if (!FILTERS.MUST_INCLUDE.test(cleanTitle) && !FILTERS.MODELS.test(cleanTitle) && !FILTERS.TOOLS.test(cleanTitle) && !FILTERS.STARTUPS.test(cleanTitle)) continue;
      } else {
        // Global: must have a strong viral/visual signal
        if (!FILTERS.VIRAL.test(cleanTitle) && !FILTERS.VISUAL.test(cleanTitle)) continue;
      }

      // --- CATEGORIZATION ---
      const region = isIndiaTech ? 'India' : 'Global';
      let categories = [];
      
      if (FILTERS.VISUAL.test(cleanTitle)) categories.push('Visual AI');
      if (FILTERS.TRAINING.test(cleanTitle)) categories.push('Training');
      if (FILTERS.APPS.test(cleanTitle)) categories.push('AI Apps');
      if (FILTERS.MODELS.test(cleanTitle)) categories.push('AI Models');
      if (FILTERS.TOOLS.test(cleanTitle)) categories.push('AI Tools');
      if (FILTERS.STARTUPS.test(cleanTitle)) categories.push('Startups');
      
      for (const [brand, regex] of Object.entries(FILTERS.TECH_BRANDS)) {
        if (regex.test(cleanTitle) || regex.test(source)) {
          categories.push('Big Tech');
          break;
        }
      }
      
      if (categories.length === 0) categories.push('General AI');

      // === EXTRACT REAL IMAGE FROM RSS ===
      const rssImage = extractRssImage(itemContent, description);
      const fallbackImage = getRelevantImage(cleanTitle, isIndiaTech);
      const imageUrl = (rssImage && rssImage.startsWith('http')) ? rssImage : fallbackImage;

      // === SMART DESCRIPTION EXTRACTION ===
      // Google News RSS wraps related article links in <ol><li><a>Title - Source</a></li></ol>
      // When HTML is stripped, you get the title repeated (sometimes 2-3x). We must detect & discard this.
      const cleanDesc = description
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
        .replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();

      // Strip any sentence that is just a repeat/remix of the title or source
      const titleWords = new Set(cleanTitle.toLowerCase().split(/\s+/).filter(w => w.length > 4));
      const isTitleEcho = (sentence) => {
        const words = sentence.toLowerCase().split(/\s+/).filter(w => w.length > 4);
        if (words.length === 0) return true;
        const overlap = words.filter(w => titleWords.has(w)).length;
        return overlap / words.length > 0.55; // >55% words overlap = it's an echo
      };

      // Split raw description into sentences, reject title echoes
      const realSentences = cleanDesc
        .split(/(?<=[.!?])\s+/)
        .map(s => s.replace(new RegExp(source, 'gi'), '').trim())
        .filter(s => s.length > 20 && !isTitleEcho(s));

      let shortDesc = '';
      if (realSentences.length > 0) {
        shortDesc = realSentences.slice(0, 2).join(' ').slice(0, 220).trim();
        if (shortDesc.length >= 220) shortDesc += '...';
      }
      // If still no real description, leave it empty — better blank than repeating the title

      // === CONTEXT-AWARE SUMMARY BULLETS (for featured card) ===
      // These should never be title echoes — generate based on category/context
      const smartSummary = {
        'Visual AI':  ["Next-gen video and image generation is reshaping creative workflows.", "AI-generated content is hitting new quality benchmarks."],
        'AI Models':  ["New model capabilities are pushing the frontier of what AI can do.", "Benchmark performance and context window sizes continue to expand."],
        'AI Tools':   ["Developer productivity tools powered by AI are accelerating software teams.", "New integrations are making AI easier to deploy in real products."],
        'Startups':   ["AI-first startups are attracting record funding in the current cycle.", "Founders are building vertical AI products at an unprecedented pace."],
        'Big Tech':   ["Enterprise AI adoption is accelerating across major platforms.", "Tech giants are racing to embed intelligence into every product layer."],
        'Training':   ["Compute infrastructure is the new battleground for frontier AI.", "GPU cluster investments are defining the next wave of model capabilities."],
        'AI Apps':    ["Autonomous AI agents are beginning to handle real-world workflows.", "Copilot-style interfaces are becoming the default for professional tools."],
        'General AI': ["The AI ecosystem continues to advance with new breakthroughs.", "Research and product innovation are converging at record pace."]
      };

      const catKey = categories[0] || 'General AI';
      const bullets = smartSummary[catKey] || smartSummary['General AI'];

      items.push({
        title: cleanTitle,
        link,
        pubDate,
        publishedAgo: pubDate ? `${Math.round((Date.now() - new Date(pubDate)) / (1000 * 60))} min ago` : '',
        source,
        imageUrl,
        category: catKey,
        categories,
        region,
        shortDesc,        // Real extracted description (may be empty)
        bullets,          // Context-aware summary bullets (for featured card)
        description: cleanDesc
      });
    }

    // Deduplicate by title across all 4 feeds, sort by newest first
    const seen = new Set();
    const dedupedItems = items
      .filter(item => {
        const key = item.title.toLowerCase().slice(0, 60);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    const result = {
      items: dedupedItems.slice(0, 80),
      fetchedAt: new Date().toISOString()
    };

    setCache(cacheKey, result, 5 * 60 * 1000); // 5-minute cache for live news
    res.json(result);
  } catch (error) {
    console.error('Error fetching AI intelligence:', error);
    res.status(500).json({ error: 'Failed to fetch AI news' });
  }
});

// AI Model Ranking Endpoint (For AILadder visualization)
app.get("/api/ai-models", async (req, res) => {
  try {
    const cacheKey = 'ai_models_ladder_v3';
    const cached = getFromCache(cacheKey);
    if (cached) return res.json(cached);

    const response = await fetch('https://openrouter.ai/api/v1/models');
    const data = await response.json();
    
    // 1. Process API Models
    const now = Math.floor(Date.now() / 1000);
    const apiModels = (data.data || [])
      .filter(m => m.name && m.pricing)
      .map(m => {
        let types = ['Text'];
        const modality = m.architecture?.modality || '';
        if (modality.includes('image')) types.push('Vision');
        if (modality.includes('video')) types.push('Video');
        if (modality.includes('audio')) types.push('Audio');
        
        return {
          id: m.id,
          name: m.name,
          context_length: m.context_length || 0,
          pricing: m.pricing,
          types: [...new Set(types)],
          provider: m.id.split('/')[0],
          isExternal: false,
          created: m.created || 0,
          isNew: (now - (m.created || 0)) < (30 * 24 * 60 * 60) // New if < 30 days old
        };
      });

    // 2. Inject Elite Global Models
    const eliteModels = [
      { id: 'openai/sora', name: 'OpenAI: Sora', context_length: 1000000, pricing: { prompt: "0.01", completion: "0.05" }, types: ['Video', 'Vision'], provider: 'OpenAI', isExternal: true, created: now, isNew: true },
      { id: 'midjourney/v6', name: 'Midjourney: v6', context_length: 0, pricing: { prompt: "0.02", completion: "0" }, types: ['Image'], provider: 'Midjourney', isExternal: true, created: now - 86400, isNew: true },
      { id: 'runway/gen3', name: 'Runway: Gen-3 Alpha', context_length: 500000, pricing: { prompt: "0.05", completion: "0" }, types: ['Video'], provider: 'Runway', isExternal: true, created: now - 172800, isNew: true },
      { id: 'suno/v3.5', name: 'Suno: v3.5', context_length: 0, pricing: { prompt: "0.01", completion: "0" }, types: ['Audio', 'Music'], provider: 'Suno', isExternal: true, created: now - 259200, isNew: true },
      { id: 'black-forest/flux-pro', name: 'BFL: Flux.1 [pro]', context_length: 0, pricing: { prompt: "0.05", completion: "0" }, types: ['Image'], provider: 'BFL', isExternal: true, created: now - 345600, isNew: true }
    ];

    // 3. Sophisticated Ranking Engine
    // Prioritizes: Elite models > Famous models (GPT/Claude) > Large Context > Recency
    const allModels = [...eliteModels, ...apiModels]
      .sort((a, b) => {
        const aScore = (a.isExternal ? 5000 : 0) + (a.id.includes('gpt-4') || a.id.includes('claude-3-5') ? 3000 : 0) + (a.context_length / 1000) + (a.isNew ? 500 : 0);
        const bScore = (b.isExternal ? 5000 : 0) + (b.id.includes('gpt-4') || b.id.includes('claude-3-5') ? 3000 : 0) + (b.context_length / 1000) + (b.isNew ? 500 : 0);
        return bScore - aScore;
      })
      .map((m, idx) => ({
        ...m,
        usage: Math.max(0.5, (45 * Math.pow(0.88, idx)).toFixed(1)) // Realistic usage decay
      }));

    const result = {
      models: allModels.slice(0, 100),
      updatedAt: new Date().toISOString()
    };

    setCache(cacheKey, result, 30 * 60 * 1000); // 30-minute cache for model rankings
    res.json(result);
  } catch (error) {
    console.error('Error fetching model rankings:', error);
    res.status(500).json({ error: 'Failed to fetch model rankings' });
  }
});

// Cloudinary API endpoints

// Get all images (for backward compatibility)
app.get("/api/cloudinary/all-images", async (req, res) => {
  try {
    const cached = getFromCache('all_images');
    if (cached) return res.json(cached);

    const result = await cloudinary.search
      .expression('resource_type:image')
      .sort_by('created_at', 'desc')
      .max_results(100)
      .execute();

    const images = result.resources.map(resource => {
      return {
        id: resource.public_id,
        url: resource.secure_url,
        publicId: resource.public_id,
        name: resource.public_id.split('/').pop(),
        folder: mapFolderToUI(resource.public_id),
        size: resource.bytes,
        width: resource.width,
        height: resource.height,
        format: resource.format,
        type: 'image',
        resourceType: 'image',
        createdAt: resource.created_at,
        originalFolder: resource.public_id.split('/')[1] || 'general',
      };
    });

    setCache('all_images', images);
    res.json(images);
  } catch (error) {
    console.error('Error fetching all images:', error);
    res.status(500).json({ error: 'Failed to fetch images' });
  }
});

// Get all files (images, PDFs, documents, etc.)
app.get("/api/cloudinary/all-files", async (req, res) => {
  try {
    const cached = getFromCache('all_files');
    if (cached) return res.json(cached);

    // Fetch all resources under home folder hierarchy
    const result = await cloudinary.search
      .expression('folder:home*')
      .sort_by('created_at', 'desc')
      .max_results(500)
      .execute();

    const files = result.resources.map(resource => {
      let fileType = 'document';
      if (resource.type === 'image') {
        fileType = 'image';
      } else if (resource.format === 'pdf') {
        fileType = 'pdf';
      } else if (['doc', 'docx', 'docm'].includes(resource.format)) {
        fileType = 'document';
      } else if (['xls', 'xlsx', 'xlsm', 'csv'].includes(resource.format)) {
        fileType = 'spreadsheet';
      } else if (['ppt', 'pptx'].includes(resource.format)) {
        fileType = 'presentation';
      }

      return {
        id: resource.public_id,
        url: resource.secure_url,
        publicId: resource.public_id,
        name: resource.public_id.split('/').pop(),
        folder: mapFolderToUI(resource.public_id),
        actualFolder: resource.folder || 'home',
        size: resource.bytes,
        width: resource.width || null,
        height: resource.height || null,
        format: resource.format,
        type: fileType,
        resourceType: resource.resource_type,
        createdAt: resource.created_at,
        originalFolder: resource.public_id.split('/')[1] || 'home',
      };
    });

    setCache('all_files', files);
    res.json(files);
  } catch (error) {
    console.error('Error fetching all files:', error);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

// Get files in a folder (all types)
app.get("/api/cloudinary/files", async (req, res) => {
  try {
    const { folder, refresh } = req.query;
    // If folder is undefined, default to 'hitam_ai', but if it's empty string, use it (root)
    const folderQuery = folder !== undefined ? folder : 'hitam_ai';
    const cacheKey = `files_${folderQuery}`;

    if (refresh !== 'true') {
      const cached = getFromCache(cacheKey);
      if (cached) return res.json(cached);
    }

    // Cloudinary Search API allows fetching mixed types
    // We add folder: query.
    const result = await cloudinary.search
      .expression(`folder:"${folderQuery}"`)
      .sort_by('created_at', 'desc')
      .max_results(500)
      .execute();

    const files = result.resources.map(file => ({
      id: file.asset_id,
      name: file.filename || file.public_id.split('/').pop(),
      publicId: file.public_id,
      url: file.secure_url,
      format: file.format,
      width: file.width,
      height: file.height,
      size: file.bytes,
      createdAt: file.created_at,
      resourceType: file.resource_type
    }));

    res.json(files);
  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

// Delete folder (and its contents)
// Helper to delete folder recursively
// Helper to delete folder recursively (Robust Version)
const deleteFolderRecursive = async (path) => {
  console.log(`🗑️ Deleting folder recursive: ${path}`);

  // 1. Find all resources in the folder using Search API (Recursive by default for search? No, strictly folder:path)
  // We need to delete resources in THIS folder first.
  // Search API "folder" expression matches exact folder.
  // We need to check both "path" and potentially "home/path" if the prefix is ambiguous, 
  // but to be safe we will just search for the exact folder strings we believe exist.

  const pathsToCheck = [path];
  // Helper to normalize path for search. 
  // If path is "hitam_ai", we search folder:"hitam_ai".

  for (const folderPath of pathsToCheck) {
    let cursor = null;
    do {
      const result = await cloudinary.search
        .expression(`folder:"${folderPath}"`)
        .max_results(500)
        .next_cursor(cursor)
        .execute();

      const resources = result.resources;
      cursor = result.next_cursor;

      if (resources.length > 0) {
        const publicIds = resources.map(r => r.public_id);
        console.log(`   - Found ${publicIds.length} assets in ${folderPath}. Deleting...`);

        // Delete in batches of 100 using Admin API
        for (let i = 0; i < publicIds.length; i += 100) {
          const batch = publicIds.slice(i, i + 100);
          try {
            await cloudinary.api.delete_resources(batch);
          } catch (err) {
            console.error(`   ! Bulk delete failed for batch starting ${batch[0]}: ${err.message}`);
            // Fallback: Destroy one by one (Upload API) - slower but different rate limits
            for (const pid of batch) {
              await cloudinary.uploader.destroy(pid).catch(e => console.error(`     - Failed to destroy ${pid}: ${e.message}`));
            }
          }
        }
      }
    } while (cursor);
  }

  // 2. Find and Process Subfolders
  // We must use Admin API for this.
  try {
    const result = await cloudinary.api.sub_folders(path);
    const subFolders = result.folders;

    if (subFolders.length > 0) {
      console.log(`   - Found ${subFolders.length} subfolders in ${path}. Recursing...`);
      // Delete subfolders sequentially to avoid rate limits
      for (const subFolder of subFolders) {
        await deleteFolderRecursive(subFolder.path);
      }
    }
  } catch (err) {
    if (err.http_code !== 404) {
      console.warn(`   ! Error fetching subfolders for ${path}: ${err.message}`);
      // If we can't list subfolders, we might fail to delete strictly empty folder later, but we continue.
    }
  }

  // 3. Delete the folder itself
  console.log(`   - Deleting empty folder: ${path}`);
  try {
    await cloudinary.api.delete_folder(path);
  } catch (err) {
    // Ignore 404 (already gone)
    if (err.http_code !== 404) {
      console.error(`   ! Failed to delete folder ${path}: ${err.message}`);
      throw err; // Propagate error
    }
  }
};

// Delete folder (recursive)
app.delete("/api/cloudinary/delete-folder", async (req, res) => {
  try {
    const { folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ error: 'Folder path required' });

    await deleteFolderRecursive(folderPath);
    clearCache();

    res.json({ success: true, message: 'Folder deleted' });
  } catch (error) {
    console.error('Error deleting folder:', error);
    res.status(500).json({ error: `Failed to delete folder: ${error.message}` });
  }
});

// Helper to rename folder recursively
const renameFolderRecursive = async (fromPath, toPath) => {
  console.log(`🔄 Rename Recursive: ${fromPath} -> ${toPath}`);

  let filesFound = 0;
  let subfoldersFound = 0;

  // 1. Rename files in this folder
  // Use Search API as primary method
  let cursor = null;
  do {
    const result = await cloudinary.search
      .expression(`folder:"${fromPath}"`)
      .max_results(500)
      .next_cursor(cursor)
      .execute();
    cursor = result.next_cursor;

    if (result.resources.length > 0) {
      filesFound += result.resources.length;
      for (const file of result.resources) {
        await renameAsset(file, fromPath, toPath);
      }
    }
  } while (cursor);

  // 1b. Fallback: If no files found via Search, check Admin API (handling indexing delays)
  if (filesFound === 0) {
    console.log(`   - Search found 0 files. Checking Admin API fallback for ${fromPath}...`);
    try {
      // Check images, video, raw
      const types = ['image', 'video', 'raw'];
      for (const type of types) {
        const res = await cloudinary.api.resources({
          type: 'upload',
          prefix: fromPath + '/', // Important: prefix must have trailing slash to target folder contents
          resource_type: type,
          max_results: 500
        });

        if (res.resources && res.resources.length > 0) {
          console.log(`   - Fallback: Found ${res.resources.length} ${type}s via Admin API.`);
          filesFound += res.resources.length;
          for (const file of res.resources) {
            await renameAsset(file, fromPath, toPath);
          }
        }
      }
    } catch (e) {
      console.warn(`   ! Admin API fallback check warning: ${e.message}`);
    }
  }

  // 2. Process subfolders
  try {
    const subRes = await cloudinary.api.sub_folders(fromPath);
    subfoldersFound = subRes.folders.length;

    for (const sub of subRes.folders) {
      const subName = sub.name;
      const newSubFrom = sub.path;
      const newSubTo = `${toPath}/${subName}`;

      await renameFolderRecursive(newSubFrom, newSubTo);
    }
  } catch (e) {
    if (e.http_code !== 404) console.warn(`   ! Subfolder fetch warning for ${fromPath}:`, e.message);
  }

  // 3. If empty (no files found in either Search or Admin API, and no subfolders), explicitly create target folder
  // This handles the case of renaming a strictly empty folder placeholder
  if (filesFound === 0 && subfoldersFound === 0) {
    console.log(`   - Empty folder detected (no files/subs). Creating target placeholder: ${toPath}`);
    try {
      await cloudinary.api.create_folder(toPath);
    } catch (e) {
      console.warn(`   ! Failed to create target folder ${toPath}:`, e.message);
    }
  }

  // 4. Delete old folder (cleanup)
  try {
    await cloudinary.api.delete_folder(fromPath);
  } catch (e) {
    if (e.http_code !== 404) console.warn(`   ! Cleanup delete failed for ${fromPath}:`, e.message);
  }
};

// Helper to rename a single asset
const renameAsset = async (file, fromPath, toPath) => {
  let currentPublicId = file.public_id;
  let targetPublicId = null;

  // Check strict directory prefix to avoid partial matching (e.g. folder vs folder_suffix)
  const candidates = [fromPath];
  if (!fromPath.startsWith('home/')) candidates.push(`home/${fromPath}`);

  for (const prefix of candidates) {
    // Require trailing slash for strict folder match
    const dirPrefix = prefix + '/';

    if (currentPublicId.startsWith(dirPrefix)) {
      let targetBase = toPath;
      if (prefix.startsWith('home/') && !toPath.startsWith('home/')) {
        targetBase = `home/${toPath}`;
      }

      const relativePath = currentPublicId.substring(dirPrefix.length);
      targetPublicId = `${targetBase}/${relativePath}`;
      break;
    }
  }

  if (!targetPublicId) {
    console.warn(`   ! Warning: File ${currentPublicId} found in search but does not match expected folder prefix ${fromPath}/`);
    return;
  }

  if (targetPublicId === currentPublicId) return;

  try {
    await cloudinary.uploader.rename(currentPublicId, targetPublicId, { resource_type: file.resource_type });
  } catch (e) {
    console.error(`   ! Failed to rename asset ${currentPublicId}:`, e.message);
  }
};

// Rename folder (Bulk rename assets)
app.post("/api/cloudinary/rename-folder", async (req, res) => {
  try {
    const { fromPath, toPath } = req.body;
    if (!fromPath || !toPath) return res.status(400).json({ error: 'Paths required' });

    console.log(`📂 Renaming folder request: "${fromPath}" -> "${toPath}"`);

    await renameFolderRecursive(fromPath, toPath);

    clearCache();
    res.json({ success: true, message: 'Folder renamed successfully' });

  } catch (error) {
    console.error('Error renaming folder:', error);
    res.status(500).json({ error: `Failed to rename folder: ${error.message}` });
  }
});

// Get all folders
app.get("/api/cloudinary/folders", async (req, res) => {
  try {
    const { parent, refresh } = req.query;
    const cacheKey = `folders_${parent || 'root'}`;

    if (refresh !== 'true') {
      const cached = getFromCache(cacheKey);
      if (cached) return res.json(cached);
    }

    let result;

    if (parent) {
      result = await cloudinary.api.sub_folders(parent);
    } else {
      result = await cloudinary.api.root_folders();
    }

    const folders = result.folders.map(folder => ({
      name: folder.name,
      path: folder.path,
      filesCount: folder.files_count || 0
    }));

    setCache(cacheKey, folders);
    res.json(folders);
  } catch (error) {
    console.error('Error fetching folders:', error);
    res.status(500).json({ error: 'Failed to fetch folders' });
  }
});

app.post("/api/cloudinary/upload", async (req, res) => {
  try {
    const { file, folder = 'home', filename } = req.body;

    if (!file) {
      return res.status(400).json({ error: 'File is required' });
    }

    // Ensure folder starts with 'home/' unless it is 'hitam_ai'
    const targetFolder = (folder.startsWith('home/') || folder.startsWith('hitam_ai')) ? folder : `home/${folder}`;

    let resType = 'auto';

    const uploadOptions = {
      folder: targetFolder,
      resource_type: resType,
    };

    if (filename) {
      const baseName = filename.substring(0, filename.lastIndexOf('.')) || filename;
      const ext = filename.substring(filename.lastIndexOf('.'));
      uploadOptions.public_id = `${baseName}_${Date.now()}${ext}`;
    } else {
      uploadOptions.use_filename = true;
    }

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(file, uploadOptions);

    clearCache();
    res.json({
      url: result.secure_url,
      publicId: result.public_id,
      folder: targetFolder,
      originalName: result.original_filename || result.public_id.split('/').pop(),
      format: result.format,
      type: result.type === 'image' ? 'image' : result.resource_type || 'document',
      resourceType: result.resource_type,
      uploadedAt: new Date().toISOString(),
      width: result.width,
      height: result.height,
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: `Upload failed: ${error.message}` });
  }
});

// Create a new folder by uploading a .keep file
app.post("/api/cloudinary/create-folder", async (req, res) => {
  try {
    const { folderPath, folderName } = req.body;

    if (!folderPath || !folderName) {
      return res.status(400).json({ error: 'Folder path and name are required' });
    }

    // Create folder explicitly using Admin API
    const targetFolder = `${folderPath}/${folderName}`;
    console.log(`📂 Creating folder via API: ${targetFolder}`);

    const result = await cloudinary.api.create_folder(targetFolder);
    console.log('✅ Folder created:', result);

    clearCache();
    res.json({
      success: true,
      message: `Folder '${folderName}' created successfully`,
      folderPath: result.path || targetFolder,
      publicId: null // No file created
    });
  } catch (error) {
    console.error('❌ Error creating folder:', error);
    res.status(500).json({ error: `Failed to create folder: ${error.message}` });
  }
});

// Rename file
app.post("/api/cloudinary/rename", async (req, res) => {
  try {
    const { fromPublicId, toPublicId } = req.body;

    if (!fromPublicId || !toPublicId) {
      return res.status(400).json({ error: 'Both fromPublicId and toPublicId are required' });
    }

    const result = await cloudinary.uploader.rename(fromPublicId, toPublicId);
    clearCache();

    res.json({
      success: true,
      message: 'File renamed successfully',
      publicId: result.public_id,
      url: result.secure_url
    });
  } catch (error) {
    console.error('Error renaming file:', error);
    res.status(500).json({ error: `Failed to rename file: ${error.message}` });
  }
});

// Delete file
app.delete("/api/cloudinary/delete", async (req, res) => {
  try {
    const { publicId, resourceType } = req.body;

    if (!publicId) {
      return res.status(400).json({ error: 'Public ID is required' });
    }

    // resource_type must be: image, video, or raw. 'auto' is not allowed for destroy.
    const type = resourceType || 'image';

    const result = await cloudinary.uploader.destroy(publicId, { resource_type: type });

    if (result.result === 'ok' || result.result === 'not found') {
      clearCache();
      res.json({ success: true, message: 'File deleted successfully' });
    } else {
      console.error('Delete result:', result);
      res.status(400).json({ error: 'Failed to delete file', result });
    }
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Send tickets
app.post("/api/send-tickets", async (req, res) => {
  try {
    const { activity, participants, customSubject, customHtml, emailColumn, nameColumn, venue, time, cc } = req.body;

    if (!activity || !participants || !Array.isArray(participants)) {
      return res.status(400).json({ error: 'Activity details and an array of participants are required' });
    }

    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    for (const participant of participants) {
      try {
        await sendTicketEmail(participant, activity, customSubject, customHtml, emailColumn, nameColumn, venue, time, cc);
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push({
          participantId: participant.id,
          error: err.message
        });
      }
    }

    res.json({ success: true, message: `Sent ${results.success} tickets. ${results.failed} failed.`, results });
  } catch (error) {
    console.error('Error in send-tickets endpoint:', error);
    res.status(500).json({ error: 'Failed to process ticket sending' });
  }
});

// Send Welcome Email
app.post("/api/send-welcome", async (req, res) => {
  try {
    const { activity, participant, nameColumn, emailColumn, customSubject, customHtml, venue, time, cc } = req.body;

    if (!activity || !participant) {
      return res.status(400).json({ error: 'Activity and participant data are required' });
    }

    const result = await sendWelcomeEmail(participant, activity, nameColumn, emailColumn, customSubject, customHtml, venue, time, cc);

    if (result.success) {
      res.json({ message: 'Welcome email sent successfully', result });
    } else {
      res.status(500).json({ error: result.error || 'Failed to send welcome email' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send Bulk Generic Email
app.post("/api/send-bulk", upload.array('attachments'), async (req, res) => {
  try {
    console.log("--- BULK DISPATCH FILES ---");
    if (req.files) {
      req.files.forEach(f => console.log(`- Original: ${f.originalname}, System: ${f.filename}, MIME: ${f.mimetype}`));
    }
    const { recipients: recipientsRaw, subject, body, cc, activity: activityRaw } = req.body;
    const attachments = req.files || [];

    // Parse recipients if sent via FormData
    let recipients = [];
    try {
      recipients = typeof recipientsRaw === 'string' ? JSON.parse(recipientsRaw) : recipientsRaw;
    } catch (e) {
      console.error("Failed to parse recipients:", e);
    }

    // Parse activity if provided
    let activity = null;
    try {
      if (activityRaw) {
        activity = typeof activityRaw === 'string' ? JSON.parse(activityRaw) : activityRaw;
      }
    } catch (e) {
      console.error("Failed to parse activity context:", e);
    }

    if (!recipients || !Array.isArray(recipients) || !subject || !body) {
      // Cleanup files on error
      attachments.forEach(file => {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      });
      return res.status(400).json({ error: 'Recipients (array), subject, and body are required' });
    }

    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    // Sequential sending to avoid SMTP throttling
    for (const recipient of recipients) {
      try {
        const { email, name } = recipient;
        const result = await sendGenericEmail(email, name, subject, body, cc, attachments, activity);
        if (result.success) {
          results.success++;
        } else {
          throw new Error(result.error);
        }
      } catch (err) {
        results.failed++;
        results.errors.push({
          email: recipient.email,
          error: err.message
        });
      }
    }

    // Cleanup files after sending
    attachments.forEach(file => {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    });

    res.json({
      success: true,
      message: `Processed ${results.success + results.failed} emails. ${results.success} sent, ${results.failed} failed.`,
      results
    });
  } catch (error) {
    console.error('Error in send-bulk endpoint:', error);
    // Cleanup files on crash
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      });
    }
    res.status(500).json({ error: 'Failed to process bulk mail' });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK", timestamp: new Date().toISOString() });
});

// Start server with port fallback
const startServer = (port) => {
  const server = app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`📍 Environment: ${isProduction ? 'Production' : 'Development'}`);
    if (process.env.FRONTEND_URL) {
      console.log(`🌐 CORS enabled for: ${process.env.FRONTEND_URL}`);
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠️  Port ${port} is busy, trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('❌ Server error:', err);
      process.exit(1);
    }
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    process.exit(0);
  });
}


// Only listen if not running on Vercel (Vercel exports the app)
if (!process.env.VERCEL) {
  startServer(PORT);
}

export default app;