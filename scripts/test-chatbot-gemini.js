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

async function seedCustomerAndOrder(senderId, brand, orderStatus, productName, size, color) {
  // Find product
  const product = await prisma.product.findFirst({
    where: { name: productName, brand },
  });
  if (!product) {
    throw new Error(`Product not found: ${productName}`);
  }

  // Find variant
  const variant = await prisma.productVariant.findUnique({
    where: {
      productId_size_color: {
        productId: product.id,
        size,
        color,
      },
    },
  });

  // Create customer
  const customer = await prisma.customer.create({
    data: {
      name: 'Simulated Customer',
      phone: '0771234567',
      externalId: senderId,
      channel: 'messenger',
      preferredBrand: brand,
    },
  });

  // Create order
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      brand,
      totalAmount: product.price,
      orderStatus,
      paymentMethod: 'COD',
      deliveryAddress: '123 Main St, Colombo',
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

  // Reserve inventory if status is not cancelled
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

    // Scenario 4: Fabric & Garment Specs
    console.log('Running Scenario D (Fabric & Garment Specs)...');
    const senderIdD = `gemini-test-sender-specs-${runId}`;
    await resetConversation(senderIdD, 'messenger');
    const scenarioDMessages = [
      'What fabric is the Breezy Summer Dress made of?',
      'Does the Pleated Midi Skirt have a side slit?'
    ];
    const transcriptD = await runConversation({
      senderId: senderIdD,
      messages: scenarioDMessages,
      baseUrl: BASE_URL,
      pageId: DEFAULT_PAGE_ID,
      channel: 'messenger',
      reset: false
    });

    const outputD = `--- SCENARIO D: Fabric & Garment Specs ---\n${formatTranscript(transcriptD)}\n\n`;
    fs.appendFileSync(LOG_FILE, outputD);
    console.log('Scenario D completed.');

    // Scenario 5: Exchange Policy & Returns
    console.log('Running Scenario E (Exchange Policy & Return Handoff)...');
    const senderIdE = `gemini-test-sender-exchanges-${runId}`;
    await resetConversation(senderIdE, 'messenger');
    const scenarioEMessages = [
      'If this dress doesn\'t fit, can I return or exchange it?',
      'What if I received a damaged item?'
    ];
    const transcriptE = await runConversation({
      senderId: senderIdE,
      messages: scenarioEMessages,
      baseUrl: BASE_URL,
      pageId: DEFAULT_PAGE_ID,
      channel: 'messenger',
      reset: false
    });

    const outputE = `--- SCENARIO E: Exchange Policy & Return Handoff ---\n${formatTranscript(transcriptE)}\n\n`;
    fs.appendFileSync(LOG_FILE, outputE);
    console.log('Scenario E completed.');

    // Scenario 6: Urgent Delivery & Courier Requests
    console.log('Running Scenario F (Urgent Delivery & Courier Requests)...');
    const senderIdF = `gemini-test-sender-delivery-urgency-${runId}`;
    await resetConversation(senderIdF, 'messenger');
    const scenarioFMessages = [
      'I need the dress urgently for a party on Friday. Can you guarantee delivery before that?',
      'Can you deliver via Koombiyo courier?'
    ];
    const transcriptF = await runConversation({
      senderId: senderIdF,
      messages: scenarioFMessages,
      baseUrl: BASE_URL,
      pageId: DEFAULT_PAGE_ID,
      channel: 'messenger',
      reset: false
    });

    const outputF = `--- SCENARIO F: Urgent Delivery & Courier Requests ---\n${formatTranscript(transcriptF)}\n\n`;
    fs.appendFileSync(LOG_FILE, outputF);
    console.log('Scenario F completed.');

    // Scenario G: COD Policy & Ordering
    console.log('Running Scenario G (COD Policy & Ordering)...');
    const senderIdG = `gemini-test-sender-cod-${runId}`;
    await resetConversation(senderIdG, 'messenger');
    const scenarioGMessages = [
      'Do you have cash on delivery?',
      'Okay, I want to order the Oversized Casual Top in Black size M',
      'Name: Amal, Street Address: 10 Temple Rd, City/Town: Colombo, District: Colombo, Phone Number: 0771112222',
      'yes correct',
      'yes correct'
    ];
    const transcriptG = await runConversation({
      senderId: senderIdG,
      messages: scenarioGMessages,
      baseUrl: BASE_URL,
      pageId: DEFAULT_PAGE_ID,
      channel: 'messenger',
      reset: false
    });
    const outputG = `--- SCENARIO G: COD Policy & Ordering ---\n${formatTranscript(transcriptG)}\n\n`;
    fs.appendFileSync(LOG_FILE, outputG);
    console.log('Scenario G completed.');

    // Scenario H: Out of Stock suggested alternatives
    console.log('Running Scenario H (Out of stock query & suggestions)...');
    const senderIdH = `gemini-test-sender-oos-${runId}`;
    await resetConversation(senderIdH, 'messenger');
    const scenarioHMessages = [
      'Do you have the Premium Evening Gown in size M?',
      'What do you have available in size M?'
    ];
    const transcriptH = await runConversation({
      senderId: senderIdH,
      messages: scenarioHMessages,
      baseUrl: BASE_URL,
      pageId: DEFAULT_PAGE_ID,
      channel: 'messenger',
      reset: false
    });
    const outputH = `--- SCENARIO H: Out of stock query & suggestions ---\n${formatTranscript(transcriptH)}\n\n`;
    fs.appendFileSync(LOG_FILE, outputH);
    console.log('Scenario H completed.');

    // Scenario I: Updating draft color/size & Phone number correction
    console.log('Running Scenario I (Draft Modifications)...');
    const senderIdI = `gemini-test-sender-draft-mod-${runId}`;
    await resetConversation(senderIdI, 'messenger');
    const scenarioIMessages = [
      'I want to get the Ribbed Crop Top in Beige, size S',
      'Wait, actually, I want it in Pink, size M',
      'My address is 25 Galle Rd, Colombo, phone 0713334444, name Nethmi',
      'Change my phone number to 0715556666',
      'yes correct',
      'yes correct'
    ];
    const transcriptI = await runConversation({
      senderId: senderIdI,
      messages: scenarioIMessages,
      baseUrl: BASE_URL,
      pageId: DEFAULT_PAGE_ID,
      channel: 'messenger',
      reset: false
    });
    const outputI = `--- SCENARIO I: Draft Modifications ---\n${formatTranscript(transcriptI)}\n\n`;
    fs.appendFileSync(LOG_FILE, outputI);
    console.log('Scenario I completed.');

    // Scenario J: Self-service order cancellation (permitted order state)
    console.log('Running Scenario J (Self-service order cancellation)...');
    const senderIdJ = `gemini-test-sender-cancel-allow-${runId}`;
    await resetConversation(senderIdJ, 'messenger');
    // Pre-seed a confirmed order
    const orderJ = await seedCustomerAndOrder(senderIdJ, 'Happybuy', 'confirmed', 'Oversized Casual Top', 'M', 'Black');
    const scenarioJMessages = [
      `Can I cancel my order #${orderJ.id}?`,
      `What is the status of my order #${orderJ.id}?`
    ];
    const transcriptJ = await runConversation({
      senderId: senderIdJ,
      messages: scenarioJMessages,
      baseUrl: BASE_URL,
      pageId: DEFAULT_PAGE_ID,
      channel: 'messenger',
      reset: false
    });
    const outputJ = `--- SCENARIO J: Self-service order cancellation ---\n${formatTranscript(transcriptJ)}\n\n`;
    fs.appendFileSync(LOG_FILE, outputJ);
    console.log('Scenario J completed.');

    // Scenario K: Non-cancellable order status query & Escalation
    console.log('Running Scenario K (Non-cancellable order cancellation)...');
    const senderIdK = `gemini-test-sender-cancel-deny-${runId}`;
    await resetConversation(senderIdK, 'messenger');
    // Pre-seed a dispatched order
    const orderK = await seedCustomerAndOrder(senderIdK, 'Happybuy', 'dispatched', 'Oversized Casual Top', 'M', 'Black');
    const scenarioKMessages = [
      `Can I cancel my order #${orderK.id}?`,
      `What is the status of my order #${orderK.id}?`
    ];
    const transcriptK = await runConversation({
      senderId: senderIdK,
      messages: scenarioKMessages,
      baseUrl: BASE_URL,
      pageId: DEFAULT_PAGE_ID,
      channel: 'messenger',
      reset: false
    });
    const outputK = `--- SCENARIO K: Non-cancellable order cancellation ---\n${formatTranscript(transcriptK)}\n\n`;
    fs.appendFileSync(LOG_FILE, outputK);
    console.log('Scenario K completed.');

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
