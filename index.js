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
    // In development, allow ALL localhost origins (any port — Vite, presenter, etc.)
    if (!isProduction) {
      if (!origin || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
        return callback(null, true);
      }
    }

    // Production whitelist
    const allowedOrigins = [
      'https://hitam-ai-club.vercel.app',
      process.env.FRONTEND_URL,
    ].filter(Boolean);

    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`⚠️ CORS blocked: ${origin}`);
      callback(new Error('CORS not allowed'));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  credentials: true,
  optionsSuccessStatus: 200
};

// ✅ Global A+ Safety Filter (Strictly blocks all 18+/NSFW/Adult content)
const GLOBAL_SAFETY_FILTER = /\bnsfw\b|\bxxx\b|\bsex\b|uncensored|no.filter|porn|adult|18\+|hentai|erotica|waifu|naked|bikini|gore|violence|drug|leaked|distilled.unc|no.safety|onlyfans|escort|nude|lust/i;

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
    console.log("📰 Incoming Intelligent News Request (24h Strict)");
    const cacheKey = 'ai_news_intelligence_v15';
    const cached = getFromCache(cacheKey);
    if (cached) return res.json(cached);

    // Common headers to prevent blocking
    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*'
    };

    // Consolidated queries to reduce request count (Strict 24h)
    const RSS_FEEDS = [
      // 1. Global AI News (Models, Tools, Startups, Video, Agents)
      `https://news.google.com/rss/search?q=${encodeURIComponent('("AI" OR "LLM" OR "ChatGPT" OR "Claude" OR "Gemini" OR "Llama" OR "Sora" OR "Kling" OR "Luma AI" OR "Kimi" OR "Devin") (model OR tool OR launch OR funding OR update OR release) when:1d')}&hl=en&gl=US&ceid=US:en`,
      // 2. India AI & Tech News (Startups, Big Tech, Research)
      `https://news.google.com/rss/search?q=${encodeURIComponent('("AI" OR "artificial intelligence" OR "tech startup" OR "Infosys" OR "TCS" OR "Ola Krutrim") India (launch OR funding OR "crore") when:1d')}&hl=en-IN&gl=IN&ceid=IN:en`,
      // 3. Open Source & Trending (Hugging Face)
      `https://huggingface.co/blog/feed.xml`
    ];

    const feedResults = await Promise.allSettled(RSS_FEEDS.map(url =>
      fetch(url, { headers: fetchHeaders, signal: AbortSignal.timeout(8000) }).then(r => r.text())
    ));

    const xml = feedResults
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value)
      .join('\n');

    // 1. Keyword Definitions
    const FILTERS = {
      MUST_INCLUDE: /\bAI\b|artificial intelligence|machine learning|deep learning|neural network|LLM|GPT|ChatGPT|Claude|Gemini|Llama|Mistral|Falcon|tech startup|generative|diffusion|transformer|automation|robotics|semiconductor|algorithm|data science|computer vision|Kling|Luma|Kimi|Devin|OpenClaw/i,
      EXCLUDE: /\bpolitics\b|\belection\b|crime|murder|shooting|drug|movie|bollywood|hollywood|celebrity|\bsports\b|cricket|football|\bweather\b|flood|earthquake|accident|\bdeath\b|obituary|stock market|forex|recipe|fashion|beauty|horoscope|astrology|religion|temple|church|mosque|\beid\b|\bfestival\b|covid|vaccine|hospital|diet|nutrition|jesus|god|bible|blasphemous|prayer|spiritual|devotional|sermon|pastor|priest|worship|faith|hindu|muslim|christian|church/i,
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
        'Mistral': /mistral/i,
        'Kuaishou': /kling|kuaishou/i,
        'Moonshot': /kimi|moonshot/i,
        'Groq': /groq/i
      },
      INDIA_TECH: /india|indian|bangalore|bengaluru|hyderabad|mumbai|delhi|chennai|iit|isro|infosys|tcs|wipro|startup india|nasscom|krutrim/i,
      TOOLS: /\btool\b|\bapp\b|platform|software|api|sdk|plugin|extension|openclaw|cursor/i,
      STARTUPS: /startup|funding|raised|series [abc]|seed round|vc|venture|acquired|acquisition|valued/i,
      MODELS: /\bmodel\b|llm|gpt|claude|gemini|llama|mistral|falcon|stable diffusion|flux|inference|benchmark|parameter|deepseek/i,
      VISUAL: /sora|midjourney|dall-e|runway|pika|kling|image gen|video gen|stable diffusion|flux|gen-3|visual ai|luma/i,
      TRAINING: /training|fine.tuning|\bgpu\b|h100|b200|dataset|pre.training|compute|supercomputer|cluster/i,
      APPS: /ai agent|\bagent\b|autonomous|copilot|assistant|chatbot/i,
      AUDIO: /suno|udio|music ai|audio gen|elevenlabs|whisper|text.to.speech/i
    };

    const AI_VISUALS = {
      video: "https://images.unsplash.com/photo-1536240478700-b869070f9279?q=80&w=1200",
      sora: "https://images.unsplash.com/photo-1684391791792-cf810ec42e3c?q=80&w=1200",
      image_gen: "https://images.unsplash.com/photo-1686191128892-cd7a56f76cf1?q=80&w=1200",
      gpt: "https://images.unsplash.com/photo-1677442136019-21780ecad995?q=80&w=1200",
      llm: "https://images.unsplash.com/photo-1680446260103-b28c2c13edfa?q=80&w=1200",
      chatbot: "https://images.unsplash.com/photo-1655720828018-edd2daec9349?q=80&w=1200",
      nvidia: "https://images.unsplash.com/photo-1591799264318-7e6ef8ddb7ea?q=80&w=1200",
      chips: "https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=1200",
      robot: "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?q=80&w=1200",
      code: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?q=80&w=1200",
      startup: "https://images.unsplash.com/photo-1559136555-9303baea8ebd?q=80&w=1200",
      funding: "https://images.unsplash.com/photo-1579621970795-87facc2f976d?q=80&w=1200",
      security: "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=80&w=1200",
      india_tech: "https://images.unsplash.com/photo-1532375810709-75b1da00537c?q=80&w=1200",
      india_ai: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?q=80&w=1200",
      network: "https://images.unsplash.com/photo-1509062522246-3755977927d7?q=80&w=1200",
      data: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=1200",
      audio: "https://images.unsplash.com/photo-1511379938547-c1f69419868d?q=80&w=1200",
      default: "https://images.unsplash.com/photo-1620712943543-bcc4628c6733?q=80&w=1200"
    };

    const extractRssImage = (itemContent, description) => {
      const mediaMatch = itemContent.match(/media:content[^>]*url=["']([^"']+)["']/i)
        || itemContent.match(/media:content[^>]*><media:thumbnail[^>]*url=["']([^"']+)["']/i)
        || itemContent.match(/<enclosure[^>]*url=["']([^"']+)["']/i)
        || itemContent.match(/<media:thumbnail[^>]*url=["']([^"']+)["']/i);
      if (mediaMatch) return mediaMatch[1];
      const ogMatch = description.match(/src=["']([^"']+\.(jpg|jpeg|png|webp))["']/i);
      if (ogMatch) return ogMatch[1];
      return null;
    };

    const getRelevantImage = (title, isIndia = false) => {
      const l = title.toLowerCase();
      if (isIndia && (l.includes('india') || l.includes('indian') || l.includes('bangalore') || l.includes('iit') || l.includes('isro'))) {
        if (l.includes('startup') || l.includes('funding') || l.includes('raises') || l.includes('growth')) return AI_VISUALS.funding;
        return AI_VISUALS.india_ai;
      }
      if (l.includes('sora') || l.includes('openai video')) return AI_VISUALS.sora;
      if (l.includes('video') || l.includes('runway') || l.includes('kling')) return AI_VISUALS.video;
      if (l.includes('image gen') || l.includes('midjourney') || l.includes('dall-e') || l.includes('flux') || l.includes('stable diffusion')) return AI_VISUALS.image_gen;
      if (l.includes('gpt') || l.includes('openai') || l.includes('chatgpt')) return AI_VISUALS.gpt;
      if (l.includes('llm') || l.includes('llama') || l.includes('mistral') || l.includes('claude') || l.includes('gemini')) return AI_VISUALS.llm;
      if (l.includes('chatbot') || l.includes('assistant') || l.includes('copilot')) return AI_VISUALS.chatbot;
      if (l.includes('nvidia') || l.includes('h100') || l.includes('b200') || l.includes('cuda')) return AI_VISUALS.nvidia;
      if (l.includes('chip') || l.includes('semiconductor') || l.includes('hardware')) return AI_VISUALS.chips;
      if (l.includes('robot') || l.includes('automation') || l.includes('tesla')) return AI_VISUALS.robot;
      if (l.includes('code') || l.includes('developer') || l.includes('software') || l.includes('api') || l.includes('sdk')) return AI_VISUALS.code;
      if (l.includes('security') || l.includes('safe') || l.includes('cyber')) return AI_VISUALS.security;
      if (l.includes('funding') || l.includes('raised') || l.includes('series')) return AI_VISUALS.funding;
      if (l.includes('startup') || l.includes('invest')) return AI_VISUALS.startup;
      if (l.includes('data') || l.includes('dataset')) return AI_VISUALS.data;
      if (l.includes('network') || l.includes('cloud')) return AI_VISUALS.network;
      if (l.includes('audio') || l.includes('music') || l.includes('voice') || l.includes('speech')) return AI_VISUALS.audio;
      return AI_VISUALS.default;
    };

    const processXml = (xmlStr, hoursCutoff = 24) => {
      const items = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;
      const cutoffDate = new Date(Date.now() - hoursCutoff * 60 * 60 * 1000);

      while ((match = itemRegex.exec(xmlStr)) !== null) {
        const itemContent = match[1];
        const title = itemContent.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "";
        const link = itemContent.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
        const pubDate = itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "";
        const source = itemContent.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || "";
        const description = itemContent.match(/<description>([\s\S]*?)<\/description>/)?.[1] || "";

        const cleanTitle = title.replace(/ - [^-]+$/, "");

        if (pubDate) {
          if (new Date(pubDate) < cutoffDate) continue;
        }

        if (!FILTERS.MUST_INCLUDE.test(cleanTitle) && !FILTERS.MUST_INCLUDE.test(description.slice(0, 200))) continue;
        if (FILTERS.EXCLUDE.test(cleanTitle)) continue;

        const isIndiaTech = FILTERS.INDIA_TECH.test(cleanTitle) || FILTERS.INDIA_TECH.test(source);
        if (isIndiaTech) {
          if (!FILTERS.MUST_INCLUDE.test(cleanTitle) && !FILTERS.MODELS.test(cleanTitle) && !FILTERS.TOOLS.test(cleanTitle) && !FILTERS.STARTUPS.test(cleanTitle)) continue;
        } else {
          if (!FILTERS.VIRAL.test(cleanTitle) && !FILTERS.VISUAL.test(cleanTitle)) continue;
        }

        const region = isIndiaTech ? 'India' : 'Global';
        let categories = [];
        if (FILTERS.VISUAL.test(cleanTitle)) categories.push('Trending Models');
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

        const rssImage = extractRssImage(itemContent, description);
        const fallbackImage = getRelevantImage(cleanTitle, isIndiaTech);
        const imageUrl = (rssImage && rssImage.startsWith('http')) ? rssImage : fallbackImage;

        const cleanDesc = description
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
          .replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();

        // Strict Safety Scan for News
        if (GLOBAL_SAFETY_FILTER.test(cleanTitle) || GLOBAL_SAFETY_FILTER.test(cleanDesc) || GLOBAL_SAFETY_FILTER.test(source)) continue;

        const titleWords = new Set(cleanTitle.toLowerCase().split(/\s+/).filter(w => w.length > 4));
        const isTitleEcho = (sentence) => {
          const words = sentence.toLowerCase().split(/\s+/).filter(w => w.length > 4);
          if (words.length === 0) return true;
          const overlap = words.filter(w => titleWords.has(w)).length;
          return overlap / words.length > 0.55;
        };

        const realSentences = cleanDesc
          .split(/(?<=[.!?])\s+/)
          .map(s => s.replace(new RegExp(source, 'gi'), '').trim())
          .filter(s => s.length > 20 && !isTitleEcho(s));

        let shortDesc = '';
        if (realSentences.length > 0) {
          shortDesc = realSentences.slice(0, 2).join(' ').slice(0, 220).trim();
          if (shortDesc.length >= 220) shortDesc += '...';
        }

        const smartSummary = {
          'Trending Models': ["Next-gen video and image generation is reshaping creative workflows.", "AI-generated content is hitting new quality benchmarks."],
          'AI Models': ["New model capabilities are pushing the frontier of what AI can do.", "Benchmark performance and context window sizes continue to expand."],
          'AI Tools': ["Developer productivity tools powered by AI are accelerating software teams.", "New integrations are making AI easier to deploy in real products."],
          'Startups': ["AI-first startups are attracting record funding in the current cycle.", "Founders are building vertical AI products at an unprecedented pace."],
          'Big Tech': ["Enterprise AI adoption is celebrating across major platforms.", "Tech giants are racing to embed intelligence into every product layer."],
          'Training': ["Compute infrastructure is the new battleground for frontier AI.", "GPU cluster investments are defining the next wave of model capabilities."],
          'AI Apps': ["Autonomous AI agents are beginning to handle real-world workflows.", "Copilot-style interfaces are becoming the default for professional tools."],
          'General AI': ["The AI ecosystem continues to advance with new breakthroughs.", "Research and product innovation are converging at record pace."]
        };

        const catKey = categories[0] || 'General AI';
        const bullets = smartSummary[catKey] || smartSummary['General AI'];

        const diffMins = pubDate ? Math.round((Date.now() - new Date(pubDate)) / (1000 * 60)) : 0;
        const timeLabel = diffMins < 60
          ? `${diffMins < 1 ? 'Just' : diffMins} ${diffMins <= 1 ? 'min' : 'mins'} ago`
          : `${Math.floor(diffMins / 60)} hour${Math.floor(diffMins / 60) > 1 ? 's' : ''} ago`;

        items.push({
          title: cleanTitle,
          link,
          pubDate,
          publishedAgo: pubDate ? timeLabel : '',
          source,
          imageUrl,
          category: catKey,
          categories,
          region,
          shortDesc,
          bullets,
          description: cleanDesc,
          isSafe: true // Explicitly marked safe after passing GLOBAL_SAFETY_FILTER
        });
      }
      return items;
    };

    let items = processXml(xml, 24);

    // 2. Live Open Source Discovery (Hugging Face Trending)
    try {
      const hfRes = await fetch('https://huggingface.co/api/trending/models?limit=15');
      const hfData = await hfRes.json();
      const hfItems = (hfData || []).map(m => ({
        title: `Trending Model: ${m.modelId.split('/')[1] || m.modelId} has surfaced on Hugging Face`,
        link: `https://huggingface.co/${m.modelId}`,
        pubDate: new Date().toISOString(),
        publishedAgo: 'Trending Now',
        source: 'Hugging Face',
        imageUrl: "https://images.unsplash.com/photo-1620712943543-bcc4628c6733?q=80&w=1200",
        category: 'Trending Models',
        categories: ['Trending Models', 'AI Models'],
        region: 'Global',
        shortDesc: `Model ${m.modelId} is currently seeing a significant spike in community interest and usage on the Hugging Face Hub.`,
        bullets: [
          "Rapidly rising in the open-source community leaderboard.",
          "Available for exploration and deployment via Hugging Face."
        ],
        description: `Model ${m.modelId} is currently trending.`
      }));
      items = [...items, ...hfItems];
    } catch (e) { console.error("HF News injection failed", e); }

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

    setCache(cacheKey, result, 5 * 60 * 1000);
    res.json(result);
  } catch (error) {
    console.error('Error fetching AI intelligence:', error);
    res.status(500).json({ error: 'Failed to fetch AI news' });
  }
});



// AI Model Ranking Endpoint (For AILadder visualization)
app.get("/api/ai-models", async (req, res) => {
  try {
    const cacheKey = 'ai_models_ladder_v16';
    const cached = getFromCache(cacheKey);
    if (cached) return res.json(cached);

    // 1. Fetch External Models (OpenRouter + Hugging Face)
    const now = Math.floor(Date.now() / 1000);
    let apiModels = [];
    let hfModels = [];

    const [orRes, hfRes] = await Promise.allSettled([
      fetch('https://openrouter.ai/api/v1/models'),
      fetch('https://huggingface.co/api/trending/models?limit=50')
    ]);

    if (orRes.status === 'fulfilled') {
      const orData = await orRes.value.json();
      apiModels = (orData.data || [])
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
            isNew: (now - (m.created || 0)) < (30 * 24 * 60 * 60),
            link: `https://openrouter.ai/models/${m.id}`
          };
        });
    }

    if (hfRes.status === 'fulfilled') {
      try {
        const hfData = await hfRes.value.json();
        hfModels = (hfData || []).map(m => ({
          id: `hf/${m.modelId}`,
          name: `HF: ${m.modelId.split('/')[1] || m.modelId}`,
          context_length: 0,
          pricing: { prompt: "0", completion: "0" },
          types: ['Text'],
          provider: 'Hugging Face',
          isExternal: true,
          created: now,
          isNew: true,
          link: `https://huggingface.co/${m.modelId}`
        }));
      } catch (e) { }
    }

    // 2. Fetch OpenRouter Live Market Data (Market Authenticity)
    let liveStats = new Map();
    try {
      const liveRes = await fetch("https://openrouter.ai/api/v1/models");
      if (liveRes.ok) {
        const liveData = await liveRes.json();
        (liveData.data || []).forEach(m => {
          liveStats.set(m.id, {
            context_length: m.context_length,
            pricing: {
              prompt: (parseFloat(m.pricing?.prompt || 0) * 1000000).toFixed(2),
              completion: (parseFloat(m.pricing?.completion || 0) * 1000000).toFixed(2)
            }
          });
        });
        console.log(`✅ Synced ${liveStats.size} live market nodes.`);
      }
    } catch (e) {
      console.error("⚠️ Market Sync Failed:", e.message);
    }

    // 3. Inject Elite Global Registry & Sync with Live Data
    const eliteModels = [
      // April 2026 Apex Rollout (Extreme Priority)
      { id: 'anthropic/claude-4.7-opus', name: 'Anthropic: Claude 4.7', context_length: 512000, pricing: { prompt: "15.00", completion: "75.00" }, types: ['Text', 'Vision', 'Agent'], provider: 'Anthropic', description: 'Released Apr 16, 2026. Anthropics latest flagship delivering sovereign high-fidelity reasoning and complex multi-token coordination.', isExternal: true, created: now, releaseDate: 'Apr 2026', isNew: true, isSafe: true, link: 'https://claude.ai' },
      { id: 'meta/llama-4-maverick', name: 'Meta: Llama 4 Maverick', context_length: 128000, pricing: { prompt: "0.00", completion: "0.00" }, types: ['Text'], provider: 'Meta AI', description: 'Released Apr 5, 2026. Metas elite April rollout, currently benchmarked as the worlds most powerful open-weights reasoning engine.', isExternal: true, created: now, releaseDate: 'Apr 2026', isNew: true, isSafe: true, link: 'https://www.meta.ai' },
      { id: 'google/gemini-nano-bana', name: 'Google: Nano Banana 2', context_length: 64000, pricing: { prompt: "0.00", completion: "0.00" }, types: ['Text', 'Image'], provider: 'Google', description: 'Released Feb 26, 2026. Codename "Banana 2", this update enables sovereign on-device imaging and high-reasoning logic.', isExternal: true, created: now, releaseDate: 'Feb 2026', isNew: true, isSafe: true, link: 'https://ai.google.dev/gemini-nano' },

      // Q1 2026 Frontier Nodes
      { id: 'google/lyria-3-pro', name: 'Google: Lyria 3 Pro', context_length: 0, pricing: { prompt: "0.20", completion: "0.20" }, types: ['Music', 'Audio'], provider: 'Google', description: 'Released Mar 25, 2026. Advanced musical engine with full structural control and native YouTube Short synthesis.', isExternal: true, created: now, releaseDate: 'Mar 2026', isNew: true, isSafe: true, link: 'https://youtube.com/creators' },
      { id: 'google/gemini-3.1-pro', name: 'Google: Gemini 3.1 Pro', context_length: 4000000, pricing: { prompt: "1.25", completion: "3.75" }, types: ['Text', 'Vision', 'Video', 'Music'], provider: 'Google', description: 'Released Feb 19, 2026. Googles premier multi-modal foundation featuring a massive 4M context window.', isExternal: true, created: now, releaseDate: 'Feb 2026', isNew: true, isSafe: true, link: 'https://gemini.google.com' },
      { id: 'bytedance/doubao-seed-2', name: 'Doubao: Seed 2.0', context_length: 512000, pricing: { prompt: "0.01", completion: "0.01" }, types: ['Text', 'Vision', 'Agent'], provider: 'ByteDance', description: 'Released Feb 14, 2026. ByteDances frontier multi-modal backbone for autonomous agentic discovery and analysis.', isExternal: true, created: now, releaseDate: 'Feb 2026', isNew: true, isSafe: true, link: 'https://www.doubao.com' },
      { id: 'moonshot/kimi-k2.5', name: 'Moonshot: Kimi K2.5', context_length: 2000000, pricing: { prompt: "1.00", completion: "1.00" }, types: ['Text'], provider: 'Moonshot', description: 'Released Jan 27, 2026. Long-context specialist capable of pinpoint retrieval across millions of data points.', isExternal: true, created: now, releaseDate: 'Jan 2026', isNew: true, isSafe: true, link: 'https://kimi.moonshot.cn' },

      // Late 2025 Cultural Milestones
      { id: 'openai/sora-2', name: 'OpenAI: Sora 2', context_length: 0, pricing: { prompt: "1.00", completion: "1.00" }, types: ['Video'], provider: 'OpenAI', description: 'Released Sept 30, 2025. Generative video benchmark delivering 25-second cinematic shots with advanced physics.', isExternal: true, created: now, releaseDate: 'Sep 2025', isNew: true, isSafe: true, link: 'https://openai.com/sora' },
      { id: 'suno/v5', name: 'Suno: v5', context_length: 0, pricing: { prompt: "0.00", completion: "0.00" }, types: ['Music', 'Audio'], provider: 'Suno', description: 'Released Sept 23, 2025. Studio-grade music composition with full vocal synthesis and instrumental stem export.', isExternal: true, created: now, releaseDate: 'Sep 2025', isNew: true, isSafe: true, link: 'https://suno.com' },
      { id: 'stability/stable-audio-2.5', name: 'Stability: Audio 2.5', context_length: 0, pricing: { prompt: "0.00", completion: "0.00" }, types: ['Music', 'Audio'], provider: 'Stability AI', description: 'Released Sept 10, 2025. High-fidelity audio synthesis specializing in rhythmic control and cinematic soundscapes.', isExternal: true, created: now, releaseDate: 'Sep 2025', isNew: true, isSafe: true, link: 'https://stability.ai' },
      { id: 'google/imagen-4', name: 'Google: Imagen 4', context_length: 0, pricing: { prompt: "0.05", completion: "0.05" }, types: ['Image'], provider: 'Google', description: 'GA since Aug 14, 2025. Googles premier image foundation node with industry-leading photo-realism.', isExternal: true, created: now, releaseDate: 'Aug 2025', isNew: true, isSafe: true, link: 'https://deepmind.google/technologies/imagen' },

      // Legacy Giants (2024)
      { id: 'openai/gpt-4o', name: 'OpenAI: GPT-4o', context_length: 128000, pricing: { prompt: "2.50", completion: "10.00" }, types: ['Text', 'Vision'], provider: 'OpenAI', description: 'Released May 13, 2024. The original multimodal benchmark for reasoning and real-time audio interaction.', isExternal: true, created: now, releaseDate: 'May 2024', isNew: false, isSafe: true, link: 'https://chat.openai.com' },
      { id: 'deepseek/v3', name: 'DeepSeek: V3', context_length: 128000, pricing: { prompt: "0.14", completion: "0.28" }, types: ['Text'], provider: 'DeepSeek', description: 'Released Dec 26, 2024. Elite MoE powerhouse delivering state-of-the-art logic and coding performance.', isExternal: true, created: now, releaseDate: 'Dec 2024', isNew: false, isSafe: true, link: 'https://www.deepseek.com' },
      { id: 'perplexity/pro', name: 'Perplexity AI', context_length: 32000, pricing: { prompt: "0.00", completion: "0.00" }, types: ['Text', 'Search'], provider: 'Perplexity', description: 'The 2023 industry standard for conversational search and live intelligence discovery.', isExternal: true, created: now, releaseDate: 'Jan 2023', isNew: false, isSafe: true, link: 'https://perplexity.ai' },
    ].map(m => {
      // Merge live market stats if available
      if (liveStats.has(m.id)) {
        const stats = liveStats.get(m.id);
        return {
          ...m,
          context_length: stats.context_length || m.context_length,
          pricing: stats.pricing || m.pricing,
          isLive: true
        };
      }
      return m;
    });

    const isModelVerifiedSafe = (m) => {
      const name = m.name?.toLowerCase() || "";
      const id = m.id?.toLowerCase() || "";

      // Stage 1: Absolute Safety Block (Applied to EVERYONE, even trusted providers)
      if (GLOBAL_SAFETY_FILTER.test(name) || GLOBAL_SAFETY_FILTER.test(id)) return false;

      // Stage 2: Verification Check (Manual entry or known reputable provider)
      if (m.isSafe) return true;

      const safeProviders = [
        'google', 'meta', 'openai', 'anthropic', 'microsoft', 'bytedance',
        'mistral', 'deepseek', 'nvidia', 'perplexity', 'phind', 'cohere',
        'replicate', 'stability', 'amazon', 'aws', 'ibm', 'snowflake',
        'adobe', 'canva', 'huggingface', 'hf', 'moonshot', '01-ai', 'alibaba',
        'baichuan', 'minimax', 'internlm', 'cogvideo', 'zhipu'
      ];
      const isTrusted = safeProviders.some(p => id.includes(p) || (m.provider?.toLowerCase().includes(p)));

      // Stage 3: Auto-Discovery Rule
      const isDiscoverySafe = m.types?.includes('Text') || m.types?.includes('Vision') || m.types?.includes('Image');

      return (isTrusted || isDiscoverySafe) && m.link;
    };

    const getLaunchLink = (m) => {
      if (m.isSafe && m.link) return m.link; // Trust elite registry links
      const id = m.id?.toLowerCase() || "";
      if (id.includes('google') || id.includes('gemini')) return 'https://gemini.google.com';
      if (id.includes('openai') || id.includes('gpt')) return 'https://chat.openai.com';
      if (id.includes('anthropic') || id.includes('claude')) return 'https://claude.ai';
      if (id.includes('meta') || id.includes('llama')) return 'https://www.meta.ai';
      if (id.includes('mistral')) return 'https://chat.mistral.ai';
      if (id.includes('deepseek')) return 'https://chat.deepseek.com';
      if (id.includes('perplexity')) return 'https://perplexity.ai';
      if (id.includes('bytedance') || id.includes('seed')) return 'https://www.doubao.com'; // ByteDance's main AI portal
      return m.link; // Fallback to OpenRouter/HF link
    };

    const seen = new Set();
    const allModels = [...eliteModels, ...hfModels, ...apiModels]
      .filter(m => {
        if (seen.has(m.id)) return false;
        // Strict A+ Filter: discard any model that doesn't meet safety criteria
        if (!isModelVerifiedSafe(m)) return false;
        seen.add(m.id);
        return true;
      })
      .sort((a, b) => {
        // Dynamic Ranking: prioritize Newest Models and Verified Giants
        const aBoost = (a.isSafe ? 10000 : 0) + (a.isNew ? 8000 : 0) + (a.context_length / 1000);
        const bBoost = (b.isSafe ? 10000 : 0) + (b.isNew ? 8000 : 0) + (b.context_length / 1000);
        return bBoost - aBoost;
      })
      .map((m, idx) => ({
        ...m,
        isSafe: true, // If it passed the filter above, it's verified safe
        link: getLaunchLink(m),
        usage: Math.max(0.2, (48 * Math.pow(0.89, idx)).toFixed(1))
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