/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_PAGE_ID,
  disconnect,
  formatTranscript,
  prisma,
  resetConversation,
  runConversation,
  sleep,
} = require('./messenger-test-helpers');

const TEST_PORT = 3200;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const LOG_FILE = path.join(__dirname, 'gemini-chat-test-results.log');

// Function to check and wait for the server
async function waitForServer(baseUrl, server, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server?.child.exitCode !== null) {
      throw new Error(`Test server exited before becoming ready.\n\n${server.getOutput()}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for test server at ${baseUrl}`);
}

function startTestServer(port) {
  const npmCommand = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
  const child = spawn(npmCommand, ['run', 'start', '--port', String(port)], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      // Do NOT set CHAT_TEST_MODE: '1', so Gemini is active!
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let bufferedOutput = '';
  const appendOutput = (chunk) => {
    bufferedOutput += chunk.toString();
  };

  child.stdout.on('data', appendOutput);
  child.stderr.on('data', appendOutput);

  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
        resolve();
      }, 5000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  };

  return { child, getOutput: () => bufferedOutput, stop };
}

async function main() {
  console.log('Starting Gemini Active Chatbot Local Test...');
  let server = null;
  
  try {
    // 1. Start the Next.js server in production mode
    server = startTestServer(TEST_PORT);
    await waitForServer(BASE_URL, server);
    console.log(`Test server is running at ${BASE_URL}`);

    const runId = Math.floor(Math.random() * 10000);
    const senderId = `gemini-test-sender-${runId}`;
    
    // Log file header
    fs.writeFileSync(LOG_FILE, `=== Chatbot Gemini Testing Log - ${new Date().toISOString()} ===\n\n`);

    // Scenario 1: English Order Flow
    console.log('Running Scenario A (English Order Flow)...');
    await resetConversation(senderId, 'messenger');
    const scenarioAMessages = [
      'Hi, what are the available items?',
      'I want to get the Breezy Summer Dress',
      'Do you have a size chart for it?',
      'I\'ll take it in Pink, M size',
      'Name: Dil, Street Address: 12 Main St, City/Town: Colombo, District: Colombo, Phone Number: 0771234567',
      'yes correct',
      'yes correct'
    ];
    const transcriptA = await runConversation({
      senderId,
      messages: scenarioAMessages,
      baseUrl: BASE_URL,
      pageId: DEFAULT_PAGE_ID,
      channel: 'messenger',
      reset: false
    });
    
    const outputA = `--- SCENARIO A: English Order Flow & Sizing ---\n${formatTranscript(transcriptA)}\n\n`;
    fs.appendFileSync(LOG_FILE, outputA);
    console.log('Scenario A completed.');

    // Scenario 2: Sinhala Delivery & Charges
    console.log('Running Scenario B (Sinhala Delivery Timing)...');
    const senderIdB = `gemini-test-sender-sinhala-${runId}`;
    await resetConversation(senderIdB, 'messenger');
    const scenarioBMessages = [
      'මට කියන්න පුළුවන්ද Colombo වලට delivery charge එක කීයද කියලා?',
      'Kandy වලට එන්න දින කීයක් යනවද?'
    ];
    const transcriptB = await runConversation({
      senderId: senderIdB,
      messages: scenarioBMessages,
      baseUrl: BASE_URL,
      pageId: DEFAULT_PAGE_ID,
      channel: 'messenger',
      reset: false
    });
    
    const outputB = `--- SCENARIO B: Sinhala Delivery & Charges ---\n${formatTranscript(transcriptB)}\n\n`;
    fs.appendFileSync(LOG_FILE, outputB);
    console.log('Scenario B completed.');

    // Scenario 3: Tamil Sizing/Catalog
    console.log('Running Scenario C (Tamil Sizing & Info)...');
    const senderIdC = `gemini-test-sender-tamil-${runId}`;
    await resetConversation(senderIdC, 'messenger');
    const scenarioCMessages = [
      'அளவுகள் என்னென்ன உள்ளன?'
    ];
    const transcriptC = await runConversation({
      senderId: senderIdC,
      messages: scenarioCMessages,
      baseUrl: BASE_URL,
      pageId: DEFAULT_PAGE_ID,
      channel: 'messenger',
      reset: false
    });
    
    const outputC = `--- SCENARIO C: Tamil Sizing & Info ---\n${formatTranscript(transcriptC)}\n\n`;
    fs.appendFileSync(LOG_FILE, outputC);
    console.log('Scenario C completed.');

    console.log(`Testing complete! Transcripts have been logged successfully to: ${LOG_FILE}`);

  } catch (error) {
    console.error('Test execution error:', error);
  } finally {
    if (server) {
      console.log('Stopping test server...');
      await server.stop();
    }
    await disconnect();
    console.log('Disconnected from database.');
  }
}

main();
