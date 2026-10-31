/**
 * Generates synthetic test images (receipts, terminal screenshots) on an offscreen HTML5 canvas
 * and returns them as native File objects to test local zero-egress OCR instantly.
 */

export function generateReceiptFile(): Promise<File> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = 500;
    canvas.height = 550;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return reject(new Error('Canvas 2D context not available'));
    }

    // White paper background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#111827';
    ctx.textBaseline = 'top';

    // Store Title
    ctx.font = 'bold 24px monospace';
    ctx.fillText('CAFE DE ROAST', 140, 30);
    ctx.font = '14px monospace';
    ctx.fillText('Order #4092 - Table 12', 150, 65);
    ctx.fillText('Date: 2026-10-31 17:30', 145, 85);

    // Separator line
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(30, 115);
    ctx.lineTo(470, 115);
    ctx.stroke();

    // Table Header
    ctx.font = 'bold 16px monospace';
    ctx.fillText('Item', 30, 130);
    ctx.fillText('Qty', 280, 130);
    ctx.fillText('Price', 400, 130);

    ctx.beginPath();
    ctx.moveTo(30, 155);
    ctx.lineTo(470, 155);
    ctx.stroke();

    // Table Line Items
    ctx.font = '15px monospace';
    const items = [
      { name: 'Espresso Double', qty: '2', price: '$7.00', y: 175 },
      { name: 'Almond Croissant', qty: '1', price: '$4.50', y: 205 },
      { name: 'Avocado Toast', qty: '1', price: '$12.00', y: 235 },
      { name: 'Iced Matcha', qty: '2', price: '$11.00', y: 265 },
    ];

    for (const item of items) {
      ctx.fillText(item.name, 30, item.y);
      ctx.fillText(item.qty, 290, item.y);
      ctx.fillText(item.price, 400, item.y);
    }

    // Subtotal & Total
    ctx.beginPath();
    ctx.moveTo(30, 305);
    ctx.lineTo(470, 305);
    ctx.stroke();

    ctx.fillText('Subtotal', 30, 325);
    ctx.fillText('$34.50', 395, 325);

    ctx.fillText('Tax (8.5%)', 30, 355);
    ctx.fillText('$2.93', 405, 355);

    ctx.font = 'bold 18px monospace';
    ctx.fillText('Total Amount', 30, 395);
    ctx.fillText('$37.43', 390, 395);

    ctx.beginPath();
    ctx.moveTo(30, 430);
    ctx.lineTo(470, 430);
    ctx.stroke();

    ctx.font = 'italic 13px monospace';
    ctx.fillText('Thank you for visiting! Zero-Egress Tested.', 85, 455);

    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Failed to create blob'));
      resolve(new File([blob], 'sample-receipt.png', { type: 'image/png' }));
    }, 'image/png');
  });
}

export function generateTerminalFile(): Promise<File> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = 680;
    canvas.height = 380;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return reject(new Error('Canvas 2D context not available'));
    }

    // Terminal dark background
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Title bar
    ctx.fillStyle = '#172033';
    ctx.fillRect(0, 0, canvas.width, 36);

    // macOS window controls
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(20, 18, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(40, 18, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(60, 18, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px monospace';
    ctx.fillText('zsh - session-worker - 80x24', 230, 22);

    // Terminal error output
    ctx.fillStyle = '#f87171';
    ctx.font = 'bold 15px monospace';
    ctx.fillText('CRITICAL ERROR: ConnectionRefusedError [Errno 111]', 20, 58);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px monospace';
    ctx.fillText('Target endpoint: 127.0.0.1:8080 (PostgreSQL Replica)', 20, 88);

    // Simulated sensitive credentials for testing PII Scrubber
    ctx.fillStyle = '#38bdf8';
    ctx.font = '13px monospace';
    ctx.fillText('Deployer User: dev-ops@internal.acme.corp', 20, 118);

    ctx.fillStyle = '#f59e0b';
    ctx.font = '13px monospace';
    ctx.fillText('Session Key: sk-proj-98a7bc1234567890abcdef123456', 20, 148);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px monospace';
    ctx.fillText('Stack Trace:', 20, 185);
    ctx.fillText('  at DatabasePool.acquireConnection (src/db/pool.ts:42:15)', 20, 210);
    ctx.fillText('  at async TransactionManager.begin (src/tx/manager.ts:88:9)', 20, 235);
    ctx.fillText('  at async handleCheckoutRequest (src/routes/pay.ts:112:5)', 20, 260);

    ctx.fillStyle = '#fbbf24';
    ctx.font = '12px monospace';
    ctx.fillText('Warning: Sensitive credentials detected in environment variables.', 20, 305);

    ctx.fillStyle = '#34d399';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('$ retry --skip-cache --verbose', 20, 340);

    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Failed to create blob'));
      resolve(new File([blob], 'terminal-stacktrace.png', { type: 'image/png' }));
    }, 'image/png');
  });
}
