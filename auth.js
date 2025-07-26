import { google } from 'googleapis';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const TOKEN_PATH = path.resolve('drive_token.json'); // Save token here

export const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

oauth2Client.on('tokens', (tokens) => {
  if (tokens.refresh_token || tokens.access_token) {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({
      ...oauth2Client.credentials,
      refresh_token: oauth2Client.credentials.refresh_token || tokens.refresh_token
    }));
    console.log('🔁 OAuth2 token updated and saved.');
  }
});


const scopes = ['https://www.googleapis.com/auth/drive.file'];

export const getAuthUrl = () =>
  oauth2Client.generateAuthUrl({ access_type: 'offline', scope: scopes });

export const getDriveClient = () => google.drive({ version: 'v3', auth: oauth2Client });

export const setTokensFromCode = async (code) => {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
};

export const loadSavedCredentials = () => {
  if (fs.existsSync(TOKEN_PATH)) {
    const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    oauth2Client.setCredentials(tokens);
  }
};