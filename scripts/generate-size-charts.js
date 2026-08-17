/**
 * Script to generate high-resolution, pixel-perfect size chart images for all brands.
 * Renders HTML templates using headless Chrome into 1231x849 PNG assets.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const rootDir = path.resolve(__dirname, '../..');
const tmpDir = path.join(rootDir, 'tmp');

if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

const happybuySkirtHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    width: 1231px;
    height: 849px;
    background: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 30px 45px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  .card {
    width: 100%;
    height: 100%;
    border: 2px solid #ef9000;
    border-radius: 16px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: #ffffff;
  }

  .header {
    background: #ef9000;
    padding: 28px 42px 24px;
    color: #ffffff;
  }

  .header h1 {
    font-size: 32px;
    font-weight: 800;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
    text-transform: uppercase;
  }

  .header p {
    font-size: 17px;
    font-weight: 400;
    opacity: 0.95;
  }

  .content {
    flex: 1;
    padding: 30px 42px 24px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  thead tr {
    background: #fff8ee;
    border-bottom: 2px solid #ef9000;
  }

  th {
    padding: 16px 14px;
    text-align: left;
    font-size: 14.5px;
    font-weight: 700;
    color: #c86600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    line-height: 1.35;
  }

  th:first-child, td:first-child {
    padding-left: 20px;
    width: 14%;
  }

  tbody tr {
    border-bottom: 1px solid #f3f4f6;
  }

  tbody tr:last-child {
    border-bottom: none;
  }

  td {
    padding: 17px 14px;
    font-size: 17px;
    color: #374151;
    font-weight: 500;
  }

  .size-cell {
    color: #ef9000;
    font-weight: 700;
    font-size: 18px;
  }

  .footer-note {
    border-top: 1px dashed #d1d5db;
    padding-top: 18px;
    font-size: 14.5px;
    line-height: 1.5;
    color: #4b5563;
  }

  .footer-note strong {
    color: #374151;
    font-weight: 700;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>HAPPY BUY</h1>
      <p>Casual & Chic Skirts Size Guide – Perfect Waist, Flattering Fit</p>
    </div>
    <div class="content">
      <table>
        <thead>
          <tr>
            <th>SIZE</th>
            <th>TO FIT WAIST<br>(INCHES)</th>
            <th>TO FIT HIP<br>(INCHES)</th>
            <th>SKIRT LENGTH<br>(INCHES)</th>
            <th>UK REFERENCE</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="size-cell">XS</td>
            <td>25"</td>
            <td>35"</td>
            <td>28.0"</td>
            <td>UK 6</td>
          </tr>
          <tr>
            <td class="size-cell">S</td>
            <td>27"</td>
            <td>37"</td>
            <td>28.5"</td>
            <td>UK 8</td>
          </tr>
          <tr>
            <td class="size-cell">M</td>
            <td>29"</td>
            <td>39"</td>
            <td>29.0"</td>
            <td>UK 10</td>
          </tr>
          <tr>
            <td class="size-cell">L</td>
            <td>31"</td>
            <td>41"</td>
            <td>29.5"</td>
            <td>UK 12</td>
          </tr>
          <tr>
            <td class="size-cell">XL</td>
            <td>33"</td>
            <td>43"</td>
            <td>30.0"</td>
            <td>UK 14</td>
          </tr>
          <tr>
            <td class="size-cell">XXL</td>
            <td>35"</td>
            <td>45"</td>
            <td>30.5"</td>
            <td>UK 16</td>
          </tr>
        </tbody>
      </table>
      <div class="footer-note">
        <strong>Note on Fit:</strong> Measurements align with natural waist positions. If styling with high-waisted designs, utilize your accurate narrowest midsection profile.
      </div>
    </div>
  </div>
</body>
</html>`;

const cleopatraSkirtHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;1,600&family=Inter:wght@400;500;600;700;800&display=swap');

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    width: 1231px;
    height: 849px;
    background: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 30px 45px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  .card {
    width: 100%;
    height: 100%;
    border: 2px solid #114b3e;
    border-radius: 16px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: #ffffff;
  }

  .header {
    background: #114b3e;
    padding: 28px 42px 24px;
    color: #ffffff;
    position: relative;
  }

  .header::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: #b86b1e;
  }

  .header h1 {
    font-size: 32px;
    font-weight: 800;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
    text-transform: uppercase;
  }

  .header p {
    font-size: 17px;
    font-weight: 400;
    opacity: 0.95;
  }

  .content {
    flex: 1;
    padding: 30px 42px 24px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  thead tr {
    background: #f4f8f6;
    border-bottom: 2px solid #b86b1e;
  }

  th {
    padding: 16px 14px;
    text-align: left;
    font-family: 'Playfair Display', Georgia, serif;
    font-size: 16.5px;
    font-weight: 700;
    color: #114b3e;
  }

  th:first-child, td:first-child {
    padding-left: 20px;
    width: 14%;
  }

  tbody tr {
    border-bottom: 1px solid #e5e7eb;
  }

  tbody tr:last-child {
    border-bottom: none;
  }

  td {
    padding: 17px 14px;
    font-size: 17px;
    color: #374151;
    font-weight: 400;
  }

  .size-cell {
    font-family: 'Playfair Display', Georgia, serif;
    color: #b86b1e;
    font-weight: 700;
    font-size: 18.5px;
  }

  .footer-note {
    border-top: 1px dashed #d1d5db;
    padding-top: 18px;
    font-size: 14.5px;
    line-height: 1.5;
    color: #4a5568;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>CLEOPATRA</h1>
      <p>Luxury Tailored & Flowing Skirt Fit Collection</p>
    </div>
    <div class="content">
      <table>
        <thead>
          <tr>
            <th>Size</th>
            <th>Natural Waist</th>
            <th>Fullest Hip</th>
            <th>Skirt Length</th>
            <th>UK Fit Reference</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="size-cell">XS</td>
            <td>25 in</td>
            <td>35 in</td>
            <td>28.0 in</td>
            <td>UK Standard 6</td>
          </tr>
          <tr>
            <td class="size-cell">S</td>
            <td>27 in</td>
            <td>37 in</td>
            <td>28.5 in</td>
            <td>UK Standard 8</td>
          </tr>
          <tr>
            <td class="size-cell">M</td>
            <td>29 in</td>
            <td>39 in</td>
            <td>29.0 in</td>
            <td>UK Standard 10</td>
          </tr>
          <tr>
            <td class="size-cell">L</td>
            <td>31 in</td>
            <td>41 in</td>
            <td>29.5 in</td>
            <td>UK Standard 12</td>
          </tr>
          <tr>
            <td class="size-cell">XL</td>
            <td>33 in</td>
            <td>43 in</td>
            <td>30.0 in</td>
            <td>UK Standard 14</td>
          </tr>
          <tr>
            <td class="size-cell">XXL</td>
            <td>35 in</td>
            <td>45 in</td>
            <td>30.5 in</td>
            <td>UK Standard 16</td>
          </tr>
        </tbody>
      </table>
      <div class="footer-note">
        Proportioned gracefully for premium fabrics. High-rise structures are balanced explicitly to accommodate fluid motion contours.
      </div>
    </div>
  </div>
</body>
</html>`;

const modabellaSkirtHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    width: 1231px;
    height: 849px;
    background: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 30px 45px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  .card {
    width: 100%;
    height: 100%;
    border: 2px solid #222b3b;
    border-radius: 16px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: #ffffff;
  }

  .header {
    background: #222b3b;
    padding: 28px 42px 24px;
    color: #ffffff;
  }

  .header h1 {
    font-size: 32px;
    font-weight: 800;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
    text-transform: uppercase;
  }

  .header p {
    font-size: 17px;
    font-weight: 400;
    opacity: 0.95;
  }

  .content {
    flex: 1;
    padding: 30px 42px 24px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  thead tr {
    background: #f8fafc;
    border-bottom: 2px solid #222b3b;
  }

  th {
    padding: 16px 14px;
    text-align: left;
    font-size: 14.5px;
    font-weight: 700;
    color: #0f172a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    line-height: 1.35;
  }

  th:first-child, td:first-child {
    padding-left: 20px;
    width: 14%;
  }

  tbody tr {
    border-bottom: 1px solid #f1f5f9;
  }

  tbody tr:last-child {
    border-bottom: none;
  }

  td {
    padding: 17px 14px;
    font-size: 17px;
    color: #334155;
    font-weight: 400;
  }

  .size-cell {
    color: #0f172a;
    font-weight: 700;
    font-size: 18px;
    display: flex;
    align-items: center;
  }

  .size-bar {
    display: inline-block;
    width: 3.5px;
    height: 18px;
    background: #e11d48;
    margin-right: 10px;
    border-radius: 1px;
  }

  .footer-note {
    border-top: 1px dashed #e2e8f0;
    padding-top: 18px;
    font-size: 14.5px;
    line-height: 1.5;
    color: #64748b;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>MODABELLA</h1>
      <p>Modernist Tailored & Midi Skirt Metric Guide</p>
    </div>
    <div class="content">
      <table>
        <thead>
          <tr>
            <th>SIZE</th>
            <th>WAIST<br>POSITION</th>
            <th>HIP METRIC</th>
            <th>SKIRT LENGTH</th>
            <th>UK REFERENCE</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><div class="size-cell"><span class="size-bar"></span>XS</div></td>
            <td>25"</td>
            <td>35"</td>
            <td>28.0"</td>
            <td>UK 6</td>
          </tr>
          <tr>
            <td><div class="size-cell"><span class="size-bar"></span>S</div></td>
            <td>27"</td>
            <td>37"</td>
            <td>28.5"</td>
            <td>UK 8</td>
          </tr>
          <tr>
            <td><div class="size-cell"><span class="size-bar"></span>M</div></td>
            <td>29"</td>
            <td>39"</td>
            <td>29.0"</td>
            <td>UK 10</td>
          </tr>
          <tr>
            <td><div class="size-cell"><span class="size-bar"></span>L</div></td>
            <td>31"</td>
            <td>41"</td>
            <td>29.5"</td>
            <td>UK 12</td>
          </tr>
          <tr>
            <td><div class="size-cell"><span class="size-bar"></span>XL</div></td>
            <td>33"</td>
            <td>43"</td>
            <td>30.0"</td>
            <td>UK 14</td>
          </tr>
          <tr>
            <td><div class="size-cell"><span class="size-bar"></span>XXL</div></td>
            <td>35"</td>
            <td>45"</td>
            <td>30.5"</td>
            <td>UK 16</td>
          </tr>
        </tbody>
      </table>
      <div class="footer-note">
        Calculated linear sizing metrics tailored specifically for contemporary structured wovens and structural crepe drapes.
      </div>
    </div>
  </div>
</body>
</html>`;

const brandCharts = [
  { name: 'happybuy', html: happybuySkirtHtml },
  { name: 'cleopatra', html: cleopatraSkirtHtml },
  { name: 'modabella', html: modabellaSkirtHtml },
];

function generate() {
  console.log('Rendering skirt size charts...');
  for (const item of brandCharts) {
    const htmlFile = path.join(tmpDir, `skirt_${item.name}.html`);
    const pngFile = path.join(tmpDir, `skirt_${item.name}.png`);
    fs.writeFileSync(htmlFile, item.html);
    execFileSync(chromePath, [
      '--headless=new',
      `--screenshot=${pngFile}`,
      '--window-size=1231,849',
      '--hide-scrollbars',
      `file://${htmlFile}`,
    ]);
    console.log(`Rendered ${item.name} skirt chart: ${pngFile}`);
  }

  const destinations = [
    // platform
    { src: 'skirt_happybuy.png', dest: path.join(rootDir, 'platform/public/size-charts/happybuy/skirts.png') },
    { src: 'skirt_cleopatra.png', dest: path.join(rootDir, 'platform/public/size-charts/cleopatra/skirts.png') },
    { src: 'skirt_modabella.png', dest: path.join(rootDir, 'platform/public/size-charts/modabella/skirts.png') },
    { src: 'skirt_happybuy.png', dest: path.join(rootDir, 'platform/public/size-charts/skirts.png') },

    // nextjs-app
    { src: 'skirt_happybuy.png', dest: path.join(rootDir, 'nextjs-app/public/size-charts/happybuy/skirts.png') },
    { src: 'skirt_happybuy.png', dest: path.join(rootDir, 'nextjs-app/public/size-charts/happyby/skirts.png') },
    { src: 'skirt_cleopatra.png', dest: path.join(rootDir, 'nextjs-app/public/size-charts/cleopatra/skirts.png') },
    { src: 'skirt_modabella.png', dest: path.join(rootDir, 'nextjs-app/public/size-charts/modabella/skirts.png') },

    // platform-tiktok-hardening
    { src: 'skirt_happybuy.png', dest: path.join(rootDir, 'platform-tiktok-hardening/public/size-charts/happybuy/skirts.png') },
    { src: 'skirt_cleopatra.png', dest: path.join(rootDir, 'platform-tiktok-hardening/public/size-charts/cleopatra/skirts.png') },
    { src: 'skirt_modabella.png', dest: path.join(rootDir, 'platform-tiktok-hardening/public/size-charts/modabella/skirts.png') },
  ];

  for (const d of destinations) {
    fs.mkdirSync(path.dirname(d.dest), { recursive: true });
    fs.copyFileSync(path.join(tmpDir, d.src), d.dest);
    console.log(`Deployed -> ${d.dest}`);
  }

  console.log('All skirt size charts successfully generated and deployed.');
}

generate();
