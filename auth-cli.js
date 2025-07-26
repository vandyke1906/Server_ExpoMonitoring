// auth-cli.js
import readline from 'readline';
import open from 'open';
import { getAuthUrl, setTokensFromCode } from './auth.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

(async () => {
  const url = getAuthUrl();
  console.log('\n🔗 Open this URL to grant access to your backend:\n');
  console.log(url + '\n');

  await open(url); // Optional — opens in default browser (works on dev machine)

  rl.question('🔑 Paste the code from the OAuth page here: ', async (code) => {
    await setTokensFromCode(code); // Creates drive_token.json
    console.log('\n✅ Token saved. Your backend can now access Google Drive.');
    rl.close();
  });
})();

// run this to generate drive token-be sure to access dashboard to add user tester
//https://console.cloud.google.com/auth/audience?inv=1&invt=Ab3zEw&project=manp-monitoring 