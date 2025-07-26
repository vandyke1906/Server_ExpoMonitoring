import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

const scopes = ['https://www.googleapis.com/auth/drive.file'];

export const getAuthUrl = () =>
  oauth2Client.generateAuthUrl({ access_type: 'offline', scope: scopes });

export const getDriveClient = () => google.drive({ version: 'v3', auth: oauth2Client });

export const setTokensFromCode = async (code) => {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
};