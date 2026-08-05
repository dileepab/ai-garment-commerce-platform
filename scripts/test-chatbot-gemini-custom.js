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

const TEST_PORT = 3300;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const LOG_FILE = path.join(__dirname, 'gemini-chat-custom-results.log');

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

async function seedCustomerAndOrder(senderId, brand, orderStatus, productName, size, color) {
  const product = await prisma.product.findFirst({
    where: { name: productName, brand },
  });
  if (!product) {
    throw new Error(`Product not found: ${productName}`);
  }

  const variant = await prisma.productVariant.findUnique({
    where: {
      productId_size_color: {
        productId: product.id,
        size,
        color,
      },
    },
  });

  const customer = await prisma.customer.create({
    data: {
      name: 'Simulated Custom Customer',
      phone: '0779998888',
      externalId: senderId,
      channel: 'messenger',
      preferredBrand: brand,
    },
  });

  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      brand,
      totalAmount: product.price,
      orderStatus,
      paymentMethod: 'COD',
      deliveryAddress: '456 Galle Rd, Colombo',
      orderItems: {
        create: [
          {
            productId: product.id,
            variantId: variant?.id ?? null,
            quantity: 1,
            price: product.price,
            size,
            color,
          },
        ],
      },
    },
  });

  if (orderStatus !== 'cancelled') {
    await prisma.inventory.update({
      where: { productId: product.id },
      data: {
        availableQty: { decrement: 1 },
        reservedQty: { increment: 1 },
      },
    });

    await prisma.product.update({
      where: { id: product.id },
      data: {
        stock: { decrement: 1 },
      },
    });

    if (variant) {
      await prisma.variantInventory.update({
        where: { variantId: variant.id },
        data: {
          availableQty: { decrement: 1 },
          reservedQty: { increment: 1 },
        },
      });
    }
  }

  return order;
}

function startTestServer(port) {
  const npmCommand = process.env.npm_execpath || (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const isPnpm = npmCommand.includes('pnpm');
  const runArgs = isPnpm
    ? ['run', 'start', '--port', String(port)]
    : ['run', 'start', '--', '--port', String(port)];
  const child = spawn(npmCommand, runArgs, {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
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
  console.log('Starting Gemini Active Chatbot Custom Test...');
  let server = null;

  try {
    server = startTestServer(TEST_PORT);
    await waitForServer(BASE_URL, server);
    console.log(`Test server is running at ${BASE_URL}`);

    const runId = Math.floor(Math.random() * 10000);
    const senderId = `gemini-custom-sender-${runId}`;

    fs.writeFileSync(LOG_FILE, `=== Chatbot Gemini Custom Phrasing Testing Log - ${new Date().toISOString()} ===\n\n`);

    // Scenario A: Sizing/availability inquiries with different phrasing
    console.log('Running Scenario A (Custom: English Sizing & Color Flow)...');
    await resetConversation(senderId, 'messenger');
    const scenarioAMessages = [
      'Hey, do you guys have the Breezy Summer Dress?',
      'Can you tell me what sizes are in stock for the Sage color?',
      'Okay, I would like to get it in Sage color, size L',
      'Actually, can I change the color to Coral? Keep it size L.',
      'Here is my info: Name is Dil, Address is 12 Main St, Colombo, phone is 0771234567',
      'Yes, that is correct',
      'Yes, confirm order'
    ];
    const transcriptA = await runConversation({
      senderId,
      messages: scenarioAMessages,
      baseUrl: BASE_URL,
      pageId: DEFAULT_PAGE_ID,
      channel: 'messenger',
      reset: false
    });
    fs.appendFileSync(LOG_FILE, `--- SCENARIO A: Sizing & Color Flow (Custom phrasing) ---\n${formatTranscript(transcriptA)}\n\n`);
    console.log('Scenario A completed.');

    // Scenario B: Sinhala questions with different phrasing
    console.log('Running Scenario B (Custom: Sinhala Delivery & Timing)...');
    const senderIdB = `gemini-custom-sender-sinhala-${runId}`;
    await resetConversation(senderIdB, 'messenger');
    const scenarioBMessages = [
      'Colombo වලට ඩිලිවරි කරන්න කීයක් ගන්නවද?',
      'මාතරට එන්න දවස් කීයක් යනවද?'
    ];
    const transcriptB = await runConversation({
      senderId: senderIdB,
      messages: scenarioBMessages,
      baseUrl: BASE_URL,
      pageId: DEFAULT_PAGE_ID,
      channel: 'messenger',
      reset: false
    });
    fs.appendFileSync(LOG_FILE, `--- SCENARIO B: Sinhala Delivery & Charges (Custom phrasing) ---\n${formatTranscript(transcriptB)}\n\n`);
    console.log('Scenario B completed.');

    // Scenario C: Tamil Sizing/Catalog with different phrasing
    console.log('Running Scenario C (Custom: Tamil Sizing & Info)...');
    const senderIdC = `gemini-custom-sender-tamil-${runId}`;
    await resetConversation(senderIdC, 'messenger');
    const scenarioCMessages = [
      'என்ன அளவுகள் கிடைக்கும்?'
    ];
    const transcriptC = await runConversation({
      senderId: senderIdC,
      messages: scenarioCMessages,
      baseUrl: BASE_URL,
      pageId: DEFAULT_PAGE_ID,
      channel: 'messenger',
      reset: false
    });
    fs.appendFileSync(LOG_FILE, `--- SCENARIO C: Tamil Sizing & Info (Custom phrasing) ---\n${formatTranscript(transcriptC)}\n\n`);
    console.log('Scenario C completed.');

    // Scenario D: Fabric & Garment Specs with different phrasing
    console.log('Running Scenario D (Custom: Fabric & Garment Specs)...');
    const senderIdD = `gemini-custom-sender-specs-${runId}`;
    await resetConversation(senderIdD, 'messenger');
    const scenarioDMessages = [
      'Pleated Midi Skirt එකේ රෙද්ද මොකක්ද?',
      'Does the Breezy Summer Dress have a side slit or zip?'
    ];
    const transcriptD = await runConversation({
      senderId: senderIdD,
      messages: scenarioDMessages,
      baseUrl: BASE_URL,
      pageId: DEFAULT_PAGE_ID,
      channel: 'messenger',
      reset: false
    });
    fs.appendFileSync(LOG_FILE, `--- SCENARIO D: Fabric & Garment Specs (Custom phrasing) ---\n${formatTranscript(transcriptD)}\n\n`);
    console.log('Scenario D completed.');

    // Scenario E: Exchange Policy & Returns with different phrasing
    console.log('Running Scenario E (Custom: Exchange Policy & Return Handoff)...');
    const senderIdE = `gemini-custom-sender-exchanges-${runId}`;
    await resetConversation(senderIdE, 'messenger');
    const scenarioEMessages = [
      'භාණ්ඩය හානි වෙලා ආවොත් මම මොකද කරන්නේ?',
      'Can I get an exchange if it doesn\'t fit?'
    ];
    const transcriptE = await runConversation({
      senderId: senderIdE,
      messages: scenarioEMessages,
      baseUrl: BASE_URL,
      pageId: DEFAULT_PAGE_ID,
      channel: 'messenger',
      reset: false
    });
    fs.appendFileSync(LOG_FILE, `--- SCENARIO E: Exchange Policy & Return Handoff (Custom phrasing) ---\n${formatTranscript(transcriptE)}\n\n`);
    console.log('Scenario E completed.');

    // Scenario F: Urgent Delivery & Courier Requests with different phrasing
    console.log('Running Scenario F (Custom: Urgent Delivery & Courier Requests)...');
    const senderIdF = `gemini-custom-sender-delivery-urgency-${runId}`;
    await resetConversation(senderIdF, 'messenger');
    const scenarioFMessages = [
      'මට හෙටට කලින් මේක ඕනෙ, deliver කරන්න පුලුවන්ද?',
      'Can you send it via Pronto or Domex courier?'
    ];
    const transcriptF = await runConversation({
      senderId: senderIdF,
      messages: scenarioFMessages,
      baseUrl: BASE_URL,
      pageId: DEFAULT_PAGE_ID,
      channel: 'messenger',
      reset: false
    });
    fs.appendFileSync(LOG_FILE, `--- SCENARIO F: Urgent Delivery & Courier Requests (Custom phrasing) ---\n${formatTranscript(transcriptF)}\n\n`);
    console.log('Scenario F completed.');

    // Scenario G: Out of Stock suggested alternatives with different phrasing
    console.log('Running Scenario G (Custom: Out of stock query & suggestions)...');
    const senderIdG = `gemini-custom-sender-oos-${runId}`;
    await resetConversation(senderIdG, 'messenger');
    const scenarioGMessages = [
      'Do you have the Premium Evening Gown in size S or M?',
      'What else do you have available in size M?'
    ];
    const transcriptG = await runConversation({
      senderId: senderIdG,
      messages: scenarioGMessages,
      baseUrl: BASE_URL,
      pageId: DEFAULT_PAGE_ID,
      channel: 'messenger',
      reset: false
    });
    fs.appendFileSync(LOG_FILE, `--- SCENARIO G: Out of stock query & suggestions (Custom phrasing) ---\n${formatTranscript(transcriptG)}\n\n`);
    console.log('Scenario G completed.');

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
