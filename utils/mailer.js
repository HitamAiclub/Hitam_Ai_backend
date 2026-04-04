import nodemailer from 'nodemailer';
import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create a reusable transporter using Gmail
// Requires EMAIL_USER and EMAIL_PASS to be set in .env
const getTransporter = () => {
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;
    
    if (!user || !pass) {
        console.error("CRITICAL: EMAIL_USER or EMAIL_PASS missing from environment variables!");
        return null;
    }

    return nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass }
    });
};

// Helper function to extract name from dynamic fields
const extractName = (data) => {
    if (!data) return "Participant";
    const commonKeys = ['name', 'full_name', 'fullName', 'Name', 'NAME', 'student_name', 'Participant Name'];
    for (const key of commonKeys) {
        if (data[key] && typeof data[key] === 'string') {
            return data[key].trim();
        }
    }

    // Try to find any property that contains "name"
    for (const key in data) {
        if (key.toLowerCase().includes('name') && typeof data[key] === 'string') {
            return data[key].trim();
        }
    }
    return "Participant";
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
const generateTicketPDF = async (participant, activity) => {
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
            const logo1Path = path.join(__dirname, '../../client/public/logo.jpg');
            const logo2Path = path.join(__dirname, '../../client/public/Hitam-logo-greenbg.png');
            let isLogoAdded = false;

            if (fs.existsSync(logo1Path)) {
                doc.image(logo1Path, 50, 50, { height: 60 });
                isLogoAdded = true;
            }

            if (fs.existsSync(logo2Path)) {
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

            if (activity.eventDate) {
                const dateParts = new Date(activity.eventDate).toLocaleString();
                doc.text(`Date & Time: ${dateParts}`);
                doc.moveDown(0.5);
            }
            if (activity.location) {
                 doc.text(`Location: ${activity.location}`);
                 doc.moveDown(0.5);
            }
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
 * Sends a ticket email with PDF attachment
 */
export const sendTicketEmail = async (participant, activity, customSubject, customHtml, emailColumn, nameColumn) => {
    try {
        let participantEmail = null;
        if (emailColumn && participant[emailColumn]) {
            participantEmail = participant[emailColumn];
        } else {
            participantEmail = extractEmail(participant);
        }

        if (!participantEmail) {
            console.log("No email found for participant:", participant);
            throw new Error(`Participant has no recognizable email address field.`);
        }

        let participantName = "Participant";
        if (nameColumn && participant[nameColumn]) {
            participantName = participant[nameColumn];
        } else {
            participantName = extractName(participant);
        }

        // Generate the PDF Buffer
        const pdfBuffer = await generateTicketPDF(participant, activity);

        const emailUser = process.env.EMAIL_USER || 'noreply@hitam.ai';
        const senderName = "HITAM AI Events";

        // Use custom or default subject
        const subject = customSubject || `Your Ticket Confirmation: ${activity.title}`;
        
        // Use custom or default HTML body, replacing standard placeholders
        let htmlBody = '';
        if (customHtml) {
            htmlBody = customHtml
                .replace(/\[Participant Name\]/gi, participantName)
                .replace(/\[Event Name\]/gi, activity.title)
                .replace(/\[Registration ID\]/gi, participant.id || '');
        } else {
            htmlBody = `
                <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; line-height: 1.6;">
                    <h2>Registration Confirmed!</h2>
                    <p>Hello <strong>${participantName}</strong>,</p>
                    <p>Your registration for the event <strong>'${activity.title}'</strong> is confirmed.</p>
                    <p>Please find your official ticket attached to this email. You will need to present the QR Code on your ticket at the venue for check-in.</p>
                    
                    <div style="background: #f4f4f4; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <p style="margin: 0;"><strong>Registration ID:</strong> ${participant.id}</p>
                    </div>

                    <p>If you have any questions, feel free to reply to this email.</p>
                    <br>
                    <p>Best Regards,</p>
                    <p><strong>The HITAM AI Team</strong></p>
                </div>
            `;
        }

        const mailOptions = {
            from: `"${senderName}" <${emailUser}>`,
            to: participantEmail,
            subject: subject,
            html: htmlBody,
            attachments: [
                {
                    filename: `ticket_${participant.id}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                }
            ]
        };

        const transporter = getTransporter();
        if (!transporter) throw new Error("Email credentials missing. Check server .env");
        const info = await transporter.sendMail(mailOptions);
        console.log(`Email sent successfully to ${participantEmail}. MessageId: ${info.messageId}`);
        return { success: true, messageId: info.messageId, email: participantEmail };
    } catch (error) {
        console.error("Error sending ticket email:", error);
        throw error;
    }
};

/**
 * Sends a simple welcome/confirmation email without attachments
 */
export const sendWelcomeEmail = async (participant, activity, nameColumn, emailColumn, customSubject, customHtml) => {
    try {
        let participantEmail = null;
        if (emailColumn && participant[emailColumn]) {
            participantEmail = participant[emailColumn];
        } else {
            participantEmail = extractEmail(participant);
        }

        if (!participantEmail) {
            console.log("No email found for welcome:", participant);
            return { success: false, error: 'No email found' };
        }

        let participantName = "Participant";
        if (nameColumn && participant[nameColumn]) {
            participantName = participant[nameColumn];
        } else {
            participantName = extractName(participant);
        }

        const emailUser = process.env.EMAIL_USER || 'noreply@hitam.ai';
        const senderName = "HITAM AI Events";

        // Handle placeholders
        const finalSubject = (customSubject || `Registration Confirmed: ${activity.title}`)
            .replace(/\[Participant Name\]/g, participantName)
            .replace(/\[Event Name\]/g, activity.title);

        const defaultHtml = `
            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; line-height: 1.6;">
                <h2 style="color: #10b981;">Registration Received! 🎉</h2>
                <p>Hello <strong>${participantName}</strong>,</p>
                <p>Thank you for registering for the event <strong>'${activity.title}'</strong>. This email confirms that we have successfully received your information.</p>
                
                <div style="background: #f0fdf4; padding: 20px; border-radius: 12px; margin: 25px 0; border: 1px solid #bbf7d0;">
                    <p style="margin: 0; color: #166534;"><strong>What's Next?</strong></p>
                    <ul style="margin-top: 10px; color: #166534; padding-left: 20px;">
                        <li>Our team will review your registration details.</li>
                        <li>You will receive your <strong>official entry ticket</strong> with a QR code closer to the event day.</li>
                        <li>Keep an eye on this email address for further updates!</li>
                    </ul>
                </div>

                <p>If you have any questions, feel free to contact us.</p>
                <br>
                <p>Best Regards,</p>
                <p><strong>The HITAM AI Team</strong></p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="font-size: 11px; color: #999;">This is an automated confirmation of your registration.</p>
            </div>
        `;

        const finalHtml = (customHtml || defaultHtml)
            .replace(/\[Participant Name\]/g, participantName)
            .replace(/\[Event Name\]/g, activity.title);

        const mailOptions = {
            from: `"${senderName}" <${emailUser}>`,
            to: participantEmail,
            subject: finalSubject,
            html: finalHtml
        };

        const transporter = getTransporter();
        if (!transporter) throw new Error("Email credentials missing. Check server .env");
        const info = await transporter.sendMail(mailOptions);
        console.log(`Welcome email sent to ${participantEmail}.`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error("Error sending welcome email:", error);
        return { success: false, error: error.message };
    }
};
