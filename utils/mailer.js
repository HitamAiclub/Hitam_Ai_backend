import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Helper function to create the email transporter.
 */
const getTransporter = () => {
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;

    if (!user || !pass) {
        console.error("Missing EMAIL_USER or EMAIL_PASS environment variables.");
        return null;
    }

    return nodemailer.createTransport({
        service: "gmail",
        auth: { user, pass }
    });
};

/**
 * Helper function to extract a name from dynamic participant fields.
 */
const extractName = (data) => {
    if (!data) return "Participant";
    
    // Explicit keys first
    const nameKeys = ['name', 'full_name', 'fullName', 'Full_Name', 'Name', 'fullname', 'fullname_address'];
    for (const key of nameKeys) {
        if (data[key] && typeof data[key] === 'string') return data[key].trim();
    }
    
    // Search for first field that isn't email, ID, or phone
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string' && value.length > 2 && 
            !emailRegex.test(value) && 
            !key.toLowerCase().includes('id') && 
            !key.toLowerCase().includes('phone')) {
            return value.trim();
        }
    }
    
    return "Participant";
};

/**
 * Helper function to wrap email content in a premium, responsive HTML shell.
 */
const wrapInDesignShell = (content, title = "Notification") => {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { margin: 0; padding: 0; background-color: #f8fafc; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
        .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05); border: 1px solid #f1f5f9; }
        .header { background: #1a1a2e; padding: 40px 40px; text-align: center; position: relative; }
        .header h1 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.025em; text-transform: uppercase; }
        .content { padding: 48px 40px; color: #1e293b; line-height: 1.6; font-size: 16px; }
        .content p { margin-bottom: 20px; }
        .content strong { color: #0f172a; }
        .footer { background: #f8fafc; padding: 32px 40px; text-align: center; border-top: 1px solid #f1f5f9; }
        .footer p { margin: 0; color: #94a3b8; font-size: 13px; margin-bottom: 8px; }
        .social-links { margin-top: 16px; font-weight: 600; color: #64748b; font-size: 12px; }
        .accent-bar { height: 4px; background: linear-gradient(93.17deg, #3b82f6 0.61%, #10b981 100%); }
        .badge { display: inline-block; padding: 6px 12px; background: #f0fdf4; color: #166534; border-radius: 99px; font-size: 12px; font-weight: 700; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.05em; }
        .highlight-box { background: #f8fafc; border-radius: 12px; padding: 20px; border: 1px solid #e2e8f0; margin: 24px 0; }
        @media only screen and (max-width: 600px) {
            .container { margin: 0; border-radius: 0; width: 100% !important; }
            .content { padding: 32px 24px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="accent-bar"></div>
        <div class="header">
            <h1 style="color: white; margin: 0;">${title}</h1>
        </div>
        <div class="content">
            ${content}
        </div>
        <div class="footer">
            <div style="margin-bottom: 20px;">
                <img src="https://hitam-ai-club.vercel.app/logo.jpg" alt="Hitam AI Club" style="width: 50px; height: 50px; border-radius: 12px; margin-bottom: 10px; display: block; margin-left: auto; margin-right: auto;"/>
                <p style="margin: 0; color: #1e293b; font-size: 16px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase;">Hitam AI Club</p>
            </div>
            <div style="margin-bottom: 20px;">
                <p style="margin: 0 0 10px 0; color: #64748b; font-weight: 700; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;">Connect With Us</p>
                <div style="text-align: center;">
                    <a href="https://www.instagram.com/hitamaiclub?igsh=aTYwcXQyZWh1NXZj" style="text-decoration: none; display: inline-block; margin: 0 8px;">
                        <img src="https://img.icons8.com/color/48/instagram-new--v1.png" alt="Instagram" style="width: 28px; height: 28px; vertical-align: middle;"/>
                    </a>
                    <a href="https://www.linkedin.com/in/hitam-ai-club-870818401" style="text-decoration: none; display: inline-block; margin: 0 8px;">
                        <img src="https://img.icons8.com/color/48/linkedin.png" alt="LinkedIn" style="width: 28px; height: 28px; vertical-align: middle;"/>
                    </a>
                </div>
            </div>
            <p style="margin: 0; color: #94a3b8; font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; border-top: 1px solid #f1f5f9; padding-top: 15px;">HITAM-AI &bull; TECHNOLOGY &bull; INNOVATION</p>
        </div>
    </div>
</body>
</html>
    `;
};

/**
 * Standardized placeholder replacement engine.
 */
const replacePlaceholders = (template, data = {}) => {
    if (!template) return "";
    
    // Default placeholders mapping
    const mapping = {
        '[Participant Name]': data.participantName || data.name || "Participant",
        '[Name]': data.participantName || data.name || "Participant",
        '[Event Name]': data.activityTitle || data.eventTitle || "Event",
        '[Venue]': data.venue || data.location || "To be announced",
        '[Time]': data.time || "To be announced",
        '[Date]': data.date || "To be announced",
        '[Registration ID]': data.registrationId || data.id || ""
    };

    let result = template;
    for (const [placeholder, value] of Object.entries(mapping)) {
        const regex = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        result = result.replace(regex, value);
    }
    return result;
};

// Helper function to extract email from dynamic fields
const extractEmail = (data) => {
    if (!data) return null;
    const commonKeys = ['email', 'email_address', 'emailAddress', 'Email', 'EMAIL', 'user_email'];
    for (const key of commonKeys) {
        if (data[key] && typeof data[key] === 'string' && data[key].includes('@')) {
            return data[key].trim();
        }
    }
    
    // Search all values for something that looks like an email
    const values = Object.values(data);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const val of values) {
        if (typeof val === 'string') {
            const trimmed = val.trim();
            if (emailRegex.test(trimmed)) return trimmed;
        }
    }
    return null;
};

// Function to generate the ticket PDF buffer
const generateTicketPDF = async (participant, activity, venue = null, time = null) => {
    return new Promise(async (resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            const buffers = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                const pdfData = Buffer.concat(buffers);
                resolve(pdfData);
            });

            // Fallback for ID if undefined
            const registrationId = participant.id || `REG-${Date.now()}`;

            // Generate QR Code data URI
            const qrCodeDataURI = await QRCode.toDataURL(registrationId, {
                errorCorrectionLevel: 'H',
                margin: 1,
                color: {
                    dark: '#000000',
                    light: '#ffffff'
                }
            });
            // Convert Base64 data URI to a Buffer that pdfkit can consume
            const qrCodeImage = Buffer.from(qrCodeDataURI.split(',')[1], 'base64');

            // --- Draw the Ticket ---

            // Draw a subtle border around the ticket area
            doc.rect(40, 40, doc.page.width - 80, 500).stroke('#cccccc');

            // Header Background Box
            doc.rect(40, 40, doc.page.width - 80, 80).fillAndStroke('#1a1a2e', '#1a1a2e');
            
            // Add Logos if they exist
            // Try multiple possible paths to accommodate different deployment structures (Local vs Vercel)
            const logo1Candidates = [
                path.join(process.cwd(), 'client/public/logo.jpg'),
                path.join(process.cwd(), 'public/logo.jpg'),
                path.join(__dirname, '../../client/public/logo.jpg'),
            ];
            
            const logo2Candidates = [
                path.join(process.cwd(), 'client/public/Hitam-logo-greenbg.png'),
                path.join(process.cwd(), 'public/Hitam-logo-greenbg.png'),
                path.join(__dirname, '../../client/public/Hitam-logo-greenbg.png'),
            ];

            const logo1Path = logo1Candidates.find(p => fs.existsSync(p));
            const logo2Path = logo2Candidates.find(p => fs.existsSync(p));

            if (logo1Path) {
                doc.image(logo1Path, 50, 50, { height: 60 });
            }

            if (logo2Path) {
                const img2Width = 120;
                doc.image(logo2Path, doc.page.width - 50 - img2Width, 50, { height: 60, width: img2Width, fit: [img2Width, 60] });
            }

            // Header Text (White)
            doc.fillColor('#ffffff').fontSize(24).text('EVENT TICKET', 0, 65, { align: 'center' });
            
            // Reset to black for main content
            doc.fillColor('#000000').moveDown();

            const ticketContentY = 150;
            const leftMargin = 70;

            // Details section Left
            doc.fontSize(18).font('Helvetica-Bold').text(activity.title || "Upcoming Activity", leftMargin, ticketContentY);
            doc.moveDown(0.5);
            doc.fontSize(12).font('Helvetica');

            const eventDate = activity.eventDate ? new Date(activity.eventDate).toLocaleDateString() : '';
            const finalTime = time || activity.eventTime || '';
            const finalVenue = venue || activity.location || '';

            doc.text(`Date: ${eventDate}`);
            doc.moveDown(0.3);
            doc.text(`Time: ${finalTime}`);
            doc.moveDown(0.3);
            doc.text(`Venue: ${finalVenue}`);
            doc.moveDown(0.5);

            if (activity.fee && activity.isPaid) {
                doc.text(`Ticket Price: ₹${activity.fee}`);
                doc.moveDown(0.5);
            }

            doc.moveDown(1);

            // Participant Info
            const pName = extractName(participant);
            const pEmail = extractEmail(participant);

            doc.font('Helvetica-Bold').fontSize(14).text('Attendee Details');
            doc.moveDown(0.5);
            doc.font('Helvetica').fontSize(12);
            doc.text(`Name: ${pName}`);
            if (pEmail) doc.text(`Email: ${pEmail}`);
            doc.text(`Registration ID: ${registrationId}`);

            // Add the QR Code Image on the right side
            const qrSize = 130;
            const rightMargin = doc.page.width - leftMargin - qrSize;
            doc.image(qrCodeImage, rightMargin, ticketContentY + 10, { width: qrSize, height: qrSize });
            
            // QR Code instructions
            doc.fontSize(9).fillColor('#666666').text('Scan to verify entry', rightMargin, ticketContentY + 10 + qrSize + 10, { width: qrSize, align: 'center' });

            // Branding / Footer of ticket
            doc.fillColor('#000000').fontSize(10).font('Helvetica-Oblique').text('Please present this ticket at the registration desk on the day of the event.', 40, 480, { align: 'center', width: doc.page.width - 80 });
            doc.font('Helvetica').text('Thank you for registering!', 40, 500, { align: 'center', width: doc.page.width - 80 });

            doc.end();

        } catch (error) {
            reject(error);
        }
    });
};

/**
 * Sends a ticket email with PDF attachment (Manual Ticket Generation)
 */
export const sendTicketEmail = async (participant, activity, customSubject, customHtml, emailColumn, nameColumn, venue = null, time = null, cc = null) => {
    try {
        let participantEmail = (emailColumn && participant[emailColumn]) ? participant[emailColumn] : extractEmail(participant);
        if (!participantEmail) throw new Error(`Recipient has no valid email address.`);

        let participantName = (nameColumn && participant[nameColumn]) ? participant[nameColumn] : extractName(participant);

        // Generate the PDF Buffer
        const pdfBuffer = await generateTicketPDF(participant, activity, venue, time);

        const emailUser = process.env.EMAIL_USER;
        const senderName = "HITAM AI Events";

        // Setup placeholder data
        const eventDate = activity.eventDate ? new Date(activity.eventDate).toLocaleDateString() : '';
        const placeholderData = {
            participantName,
            activityTitle: activity.title,
            registrationId: participant.id,
            venue: venue || activity.location,
            time: time || activity.eventTime,
            date: eventDate
        };

        const subject = replacePlaceholders(customSubject || `Your Ticket Confirmation: ${activity.title}`, placeholderData);
        
        let contentHtml = customHtml || `
            <div class="badge">Registration Confirmed</div>
            <p>Hello <strong>${participantName}</strong>,</p>
            <p>Your registration for the event <strong>'${activity.title}'</strong> is successfully confirmed.</p>
            <p>Please find your official entry ticket attached to this email. You will need to present the QR Code on your ticket at the venue for check-in.</p>
            
            <div class="highlight-box">
                <p style="margin: 0;"><strong>Registration ID:</strong> ${participant.id || 'N/A'}</p>
                <p style="margin: 5px 0 0 0;"><strong>Event:</strong> ${activity.title}</p>
            </div>

            <p>If you have any questions, feel free to reply to this email.</p>
            <br>
            <p>Best Regards,</p>
            <p><strong>The HITAM AI Team</strong></p>
        `;

        const finalHtml = wrapInDesignShell(replacePlaceholders(contentHtml, placeholderData), "Event Ticket");

        const mailOptions = {
            from: `"${senderName}" <${emailUser}>`,
            to: participantEmail,
            subject: subject,
            html: finalHtml,
            cc: cc,
            attachments: [
                {
                    filename: `ticket_${participant.id || 'reg'}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                }
            ]
        };

        const transporter = getTransporter();
        if (!transporter) throw new Error("Email credentials missing.");
        const info = await transporter.sendMail(mailOptions);
        return { success: true, messageId: info.messageId, email: participantEmail };
    } catch (error) {
        console.error("Error sending ticket email:", error);
        throw error;
    }
};

/**
 * Sends an automatic registration confirmation email (Post-Registration)
 */
export const sendWelcomeEmail = async (participant, activity, nameColumn, emailColumn, customSubject, customHtml, venue = null, time = null, cc = null) => {
    try {
        let participantEmail = (emailColumn && participant[emailColumn]) ? participant[emailColumn] : extractEmail(participant);
        if (!participantEmail) return { success: false, error: 'No email found' };

        let participantName = (nameColumn && participant[nameColumn]) ? participant[nameColumn] : extractName(participant);

        const emailUser = process.env.EMAIL_USER;
        const senderName = "HITAM AI Events";

        const eventDate = activity.eventDate ? new Date(activity.eventDate).toLocaleDateString() : '';
        const placeholderData = {
            participantName,
            activityTitle: activity.title,
            registrationId: participant.id,
            venue: venue || activity.location,
            time: time || activity.eventTime,
            date: eventDate
        };

        const finalSubject = replacePlaceholders(customSubject || `Registration Confirmed: ${activity.title}`, placeholderData);

        const defaultHtml = `
            <div class="badge">Success</div>
            <h2 style="color: #10b981; margin-top: 5px;">Registration Received! 🎉</h2>
            <p>Hello <strong>${participantName}</strong>,</p>
            <p>Thank you for registering for <strong>'${activity.title}'</strong>. This email confirms that we have successfully received your information.</p>
            
            <div class="highlight-box">
                <p style="margin: 0; color: #1e293b;"><strong>What's Next?</strong></p>
                <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #475569;">
                    <li>Our team will review your registration details.</li>
                    <li>You will receive your <strong>official entry ticket</strong> with a QR code closer to the event day.</li>
                    <li>Keep an eye on this email address for further updates!</li>
                </ul>
            </div>

            <p>If you have any questions, feel free to contact us.</p>
            <br>
            <p>Best Regards,</p>
            <p><strong>The HITAM AI Team</strong></p>
        `;

        const finalHtml = wrapInDesignShell(replacePlaceholders(customHtml || defaultHtml, placeholderData), "Registration Confirmation");

        const mailOptions = {
            from: `"${senderName}" <${emailUser}>`,
            to: participantEmail,
            subject: finalSubject,
            html: finalHtml,
            cc: cc
        };

        const transporter = getTransporter();
        if (!transporter) throw new Error("Email credentials missing.");
        const info = await transporter.sendMail(mailOptions);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error("Error sending confirmation email:", error);
        return { success: false, error: error.message };
    }
};

/**
 * Sends a general broadcast email (Mail Center)
 */
export const sendGenericEmail = async (to, name, subject, body, cc = null, attachments = [], activityContext = null) => {
    try {
        if (!to) throw new Error("Recipient email is required");

        const transporter = getTransporter();
        if (!transporter) throw new Error("Email credentials missing.");

        const emailUser = process.env.EMAIL_USER;
        const senderName = activityContext ? (activityContext.title || "HITAM AI Events") : "HITAM AI CLUB";

        // Placeholder context
        const placeholderData = {
            participantName: name || "Member",
            name: name || "Member"
        };
        
        if (activityContext) {
            placeholderData.activityTitle = activityContext.title;
            placeholderData.venue = activityContext.location;
            placeholderData.date = activityContext.eventDate ? new Date(activityContext.eventDate).toLocaleDateString() : '';
            placeholderData.time = activityContext.eventTime;
        }

        const finalSubject = replacePlaceholders(subject, placeholderData);
        const contentHtml = replacePlaceholders(body, placeholderData);
        const finalHtml = wrapInDesignShell(contentHtml, senderName);

        const mailOptions = {
            from: `"${senderName}" <${emailUser}>`,
            to: to,
            subject: finalSubject,
            html: finalHtml,
            cc: cc,
            attachments: attachments.map(file => ({
                filename: file.originalname || file.filename,
                path: file.path,
                contentType: file.mimetype
            }))
        };

        const info = await transporter.sendMail(mailOptions);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error("Error sending generic email:", error);
        return { success: false, error: error.message };
    }
};


