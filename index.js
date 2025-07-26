import express from "express";
import cors from "cors";
import { createClient } from "@libsql/client";
import multer  from "multer";
import bodyParser  from "body-parser";
import path  from "path";
import fs  from "fs";
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { getAuthUrl, getDriveClient, loadSavedCredentials, oauth2Client, setTokensFromCode } from "./auth.js";
import dotenv from "dotenv";
import open from 'open';


dotenv.config();  // Load env vars if running locally (optional)

loadSavedCredentials(); // Make sure credentials are loaded on boot


const app = express();

// ESM-safe __dirname workaround
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const uploadMiddleware = multer({ storage: multer.memoryStorage() }).any(); // Use memory storage first


// 🛠 Ensure uploads directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

// Parse JSON in text field
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


const db = createClient({
  url: process.env.TURSO_DB_URL,
  authToken: process.env.TURSO_DB_TOKEN,
});


app.get("/", (req, res) => {
  res.send("🟢 MANP Monitoring service API is live.");
});


app.post("/sync", async (req, res) => {
  console.info("Syncing...");
  try {
    const reports = req.body.reports;

    for (const report of reports) {
        console.error("Syncing:", { report });
        const values = [
            report.id,
            report.user_id,
            JSON.stringify(report.denr_personnels), // array → string
            report.other_agency_personnels ? JSON.stringify(report.other_agency_personnels) : null,
            report.activity_date_start,
            report.activity_date_end || null,
            report.location,
            report.persons_involved,
            report.complaint_description,
            report.action_taken,
            report.recommendation,
            report.photos ? JSON.stringify(report.photos) : null, // array → string or null
            1, // integer
            report.created_at
        ];
        await db.execute({
            sql: `
            INSERT INTO reports (
                id, user_id, denr_personnels, other_agency_personnels,
                activity_date_start, activity_date_end, location,
                persons_involved, complaint_description, action_taken,
                recommendation, photos, synced, created_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            ON CONFLICT(id) DO NOTHING;
            `,
            args: values,
      });
    }

    res.status(200).json({ success: true, count: reports.length });
  } catch (error) {
    console.error("❌ Sync error:", error);
    res.status(500).json({ error: "Failed to sync reports." });
  }
});

app.get("/reports/:userId", async (req, res) => {
  const { userId } = req.params;
  console.info("Fetching user reports...");
  try {
    const result = await db.execute({
      sql: `
        SELECT 
          id, user_id, denr_personnels, other_agency_personnels,
          activity_date_start, activity_date_end, location,
          persons_involved, complaint_description, action_taken,
          recommendation, photos, synced, created_at
        FROM reports
        WHERE user_id = ?1
        ORDER BY created_at DESC;
      `,
      args: [userId],
    });

    // Parse JSON fields before sending back to client
    const reports = result.rows.map((row) => ({
      ...row,
      denr_personnels: JSON.parse(row.denr_personnels),
      other_agency_personnels: row.other_agency_personnels ? JSON.parse(row.other_agency_personnels) : null,
      photos: row.photos ? JSON.parse(row.photos) : null,
    }));

    res.status(200).json({ success: true, reports });
  } catch (error) {
    console.error("❌ Fetch reports error:", error);
    res.status(500).json({ error: "Failed to fetch reports." });
  }
});

app.post('/upload-report', uploadMiddleware, async (req, res) => {
  try {
    // Extract and parse JSON report metadata
    const reportData = JSON.parse(req.body.report);
    console.info(`Uploading report: \n${JSON.stringify(reportData, null, 2)}`);
    const {
      user_id,
      denr_personnels,
      other_agency_personnels,
      activity_date_start,
      activity_date_end,
      location,
      persons_involved,
      complaint_description,
      action_taken,
      recommendation,
      created_at
    } = reportData;

    const reportId = `${user_id}-${Date.now()}`;
    const safeTimestamp = created_at.replace(/:/g, '-'); // filesystem-safe
    const updated_at = created_at;

    // Save uploaded files to nested folder in current server
    // Create user/timestamp folder
    const targetDir = path.join(UPLOAD_DIR, user_id, safeTimestamp);
    fs.mkdirSync(targetDir, { recursive: true });

    const photoFiles = [];

    for (const file of req.files) {
      const filename = file.originalname;
      const filepath = path.join(targetDir, filename);
      fs.writeFileSync(filepath, file.buffer);

      //NOTE:: add the code here for uploading the files to google drive with folder id of 11Z0_1epYPiEGCE5s3Yl6capE9eopQIR8

      // ▶️ Convert buffer to ReadableStream for Drive upload
      const bufferStream = new Readable();
      bufferStream.push(file.buffer);
      bufferStream.push(null);

      // 📤 Upload to Google Drive
      const drive = getDriveClient();
      
      // 1. Create or get user folder inside root
      const findOrCreateFolder = async (folderName, parentId) => {
        const searchRes = await drive.files.list({
          q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and '${parentId}' in parents`,
          fields: 'files(id, name)',
        });

        if (searchRes.data.files.length > 0) {
          return searchRes.data.files[0].id;
        }

        const folderRes = await drive.files.create({
          resource: {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId],
          },
          fields: 'id',
        });

        return folderRes.data.id;
      };

      try {
        // 🗂️ Step 1: Get or create user's Drive folder under root
        const userFolderId = await findOrCreateFolder(user_id, process.env.GOOGLE_DRIVE_MONITORING_FOLDER);

        // 🗂️ Step 2: Get or create created_at timestamp folder inside user folder
        const safeTimestamp = created_at.replace(/:/g, '-');
        const timestampFolderId = await findOrCreateFolder(safeTimestamp, userFolderId);

        // 📤 Step 3: Upload photo to Drive inside timestamp folder
        const fileMetadata = {
          name: filename,
          parents: [timestampFolderId],
        };

        const bufferStream = new Readable();
        bufferStream.push(file.buffer);
        bufferStream.push(null);

        const media = {
          mimeType: file.mimetype,
          body: bufferStream,
        };

        console.log('OAuth2 loaded credentials:', oauth2Client.credentials); //
        const driveResponse = await drive.files.create({
          resource: fileMetadata,
          media,
          fields: 'id, webViewLink, name',
        });

        photoFiles.push({
          filename,
          path: filepath,
          mimetype: file.mimetype,
          drive_id: driveResponse.data.id,
          drive_link: driveResponse.data.webViewLink,
        });

        console.info(`✅ Uploaded to Drive: ${filename} → ${driveResponse.data.webViewLink}`);
      } catch (driveErr) {
        console.error(`❌ Drive upload failed for ${filename}: ${driveErr.message}`);
      }

      // 📤 Upload to Google Drive

      //NOTE:: add the code here for uploading the files to google drive with folder id of 11Z0_1epYPiEGCE5s3Yl6capE9eopQIR8

      // photoFiles.push({
      //   filename,
      //   path: filepath,
      //   mimetype: file.mimetype
      // });
    }
    // Save uploaded files to nested folder in current server

    // Store report to DB
    const insertResult = await db.execute({
      sql: `
        INSERT INTO reports (
          id, user_id, denr_personnels, other_agency_personnels,
          activity_date_start, activity_date_end, location,
          persons_involved, complaint_description, action_taken,
          recommendation, photos, synced, created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15);
      `,
      args: [
        reportId,
        user_id,
        JSON.stringify(denr_personnels),
        other_agency_personnels ? JSON.stringify(other_agency_personnels) : null,
        activity_date_start,
        activity_date_end || null,
        location,
        persons_involved,
        complaint_description,
        action_taken,
        recommendation,
        JSON.stringify(photoFiles),
        1,
        created_at,
        updated_at
      ]
    });

    res.status(200).json({
      success: true,
      report_id: reportId,
      saved_photos: photoFiles.length,
      photo_urls: photoFiles.map(p => p.url)
    });
  } catch (err) {
    console.error('❌ Upload error:', err);
    res.status(500).json({ error: 'Failed to process upload' });
  }
});


app.get('/auth', (req, res) => {
  const url = getAuthUrl();
  if (process.env.NODE_ENV === 'development') open(url);
  res.send('Redirecting for authentication...');
});

app.get('/oauth2callback', async (req, res) => {
  await setTokensFromCode(req.query.code);
  res.send('Authenticated successfully!');
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
