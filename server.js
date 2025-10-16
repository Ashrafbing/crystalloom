const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const Razorpay = require('razorpay');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from root directory
app.use(express.static(__dirname));

// Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Email transporter
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Razorpay instance (only initialize if keys are available)
let razorpay = null;
console.log("Loaded Razorpay Key ID:", process.env.RAZORPAY_KEY_ID ? process.env.RAZORPAY_KEY_ID.substring(0, 5) + "..." : "Not Set");
console.log("Loaded Razorpay Key Secret:", process.env.RAZORPAY_KEY_SECRET ? process.env.RAZORPAY_KEY_SECRET.substring(0, 5) + "..." : "Not Set");

if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

// OTP storage (in production, use Redis or DB)
const otpStore = new Map();

// Google Apps Script web app URL
const sheetsUrl = 'https://script.google.com/macros/s/AKfycbzj1UqzwYHP2heApV6vCKIDKsD40H79Bug5GBWXmmmV3JLhmDcKYzZ7QKmKbpwkqNNw/exec';

// Routes

// User registration
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const { data, error } = await supabase
      .from('users')
      .insert([{ name, email, password }]);

    if (error) throw error;

    // Append signup details to Google Sheets (non-blocking)
    try {
      await fetch(sheetsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'signup',
          name,
          email,
          time: new Date().toISOString()
        }),
      });
    } catch (sheetsError) {
      console.error('Sheets integration error:', sheetsError.message);
      // Continue with signup even if sheets fail
    }

    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// User login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .eq('password', password)
      .single();

    if (error) throw error;

    res.json({ user: data });
  } catch (error) {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Update user personal info
app.put('/api/user/:id/personal', async (req, res) => {
  const { id } = req.params;
  const personalInfo = req.body;

  try {
    const { data, error } = await supabase
      .from('users')
      .update({ personal_info: personalInfo })
      .eq('id', id);

    if (error) throw error;

    res.json({ message: 'Personal info updated successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Create Razorpay order
app.post('/api/create-razorpay-order', async (req, res) => {
  const { amount, currency = 'INR' } = req.body;

  if (!razorpay) {
    return res.status(500).json({ error: 'Razorpay not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables.' });
  }

  try {
    const options = {
      amount: amount * 100, // Razorpay expects amount in paisa
      currency,
      receipt: `receipt_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);
    res.json({
      id: order.id,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// Place order
app.post('/api/order', async (req, res) => {
  const { userId, email, cart, total, shippingInfo } = req.body;
  const orderId = uuidv4();

  try {
    // Fetch username from users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('name')
      .eq('id', userId)
      .single();

    if (userError) throw userError;

    const username = userData.name;

    // Insert order
    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .insert([{
        id: orderId,
        user_id: userId,
        username,
        total,
        shipping_info: shippingInfo,
        status: 'confirmed'
      }]);

    if (orderError) throw orderError;

    // Insert order items
    const orderItems = cart.map(item => ({
      order_id: orderId,
      username,
      product_name: item.name,
      price: item.price,
      quantity: item.qty
    }));

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems);

    if (itemsError) throw itemsError;

    // Insert initial status into order_status_history
    const { error: historyError } = await supabase
      .from('order_status_history')
      .insert([{
        order_id: orderId,
        status: 'confirmed'
      }]);

    if (historyError) throw historyError;

    // Append order details to Google Sheets (non-blocking)
    try {
      await fetch(sheetsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'order',
          orderId,
          name: shippingInfo.name,
          email,
          phone: shippingInfo.phone,
          address: `${shippingInfo.address}, ${shippingInfo.city}, ${shippingInfo.state} - ${shippingInfo.pincode}`,
          total,
          items: cart.map(item => `${item.name} x ${item.qty} @ ₹${item.price}`).join('; '),
          time: new Date().toISOString()
        }),
      });
    } catch (sheetsError) {
      console.error('Sheets integration error:', sheetsError.message);
      // Continue with order even if sheets fail
    }

    // Generate invoice (simple text for now)
    const invoice = generateInvoice(orderId, cart, total, shippingInfo);

    // Send order confirmation emails
    const itemsHtml = cart.map(item => `<tr><td>${item.name}</td><td>₹${item.price}</td><td>${item.qty}</td><td>₹${item.price * item.qty}</td></tr>`).join('');
    const emailOrderData = {
      name: shippingInfo.name,
      orderId,
      orderDate: new Date().toLocaleDateString(),
      address: shippingInfo.address,
      city: shippingInfo.city,
      state: shippingInfo.state,
      pincode: shippingInfo.pincode,
      phone: shippingInfo.phone,
      total,
      itemsHtml
    };

    // Send to user
    sendOrderConfirmationEmail(email, 'Order Confirmation', emailOrderData);

    // Send to owner
    const ownerEmail = 'crystalloom9@gmail.com';
    emailOrderData.name = 'Admin';
    sendOrderConfirmationEmail(ownerEmail, 'New Order Received', emailOrderData);

    res.json({ orderId, invoice });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get user orders
app.get('/api/user/:id/orders', async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (*),
        order_status_history (*)
      `)
      .eq('user_id', id);

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Forgot password - send OTP
app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;

  try {
    // Check if user exists
    const { data: user, error } = await supabase
      .from('users')
      .select('email')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Store OTP
    otpStore.set(email, { otp, expires });

    // Send email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Password Reset OTP - Crystal Loom',
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Reset OTP</title>
          <style>
            body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
            .header { text-align: center; padding: 20px 0; background-color: #22c55e; color: white; border-radius: 8px 8px 0 0; }
            .content { padding: 20px; text-align: center; }
            .otp-code { font-size: 32px; font-weight: bold; color: #22c55e; background-color: #f0fdf4; padding: 15px; border-radius: 5px; margin: 20px 0; letter-spacing: 5px; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #eee; }
            .logo { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">Crystal Loom</div>
              <h1>Password Reset</h1>
            </div>
            <div class="content">
              <h2>Hello,</h2>
              <p>We received a request to reset your password for your Crystal Loom account.</p>
              <p>Your One-Time Password (OTP) is:</p>
              <div class="otp-code">${otp}</div>
              <p>This OTP will expire in <strong>10 minutes</strong> for security reasons.</p>
              <p>If you didn't request this password reset, please ignore this email.</p>
              <p>For security, do not share this OTP with anyone.</p>
            </div>
            <div class="footer">
              <p>© 2024 Crystal Loom. All rights reserved.</p>
              <p>If you have any questions, contact us at support@crystalloom.com</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.json({ message: 'OTP sent to your email' });
  } catch (error) {
    console.error('Error sending OTP email:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// Verify OTP
app.post('/api/verify-otp', (req, res) => {
  const { email, otp } = req.body;

  const stored = otpStore.get(email);
  if (!stored || stored.otp !== otp || Date.now() > stored.expires) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }

  // OTP verified, can reset password
  res.json({ message: 'OTP verified' });
});

// Reset password
app.post('/api/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;

  const stored = otpStore.get(email);
  if (!stored || stored.otp !== otp || Date.now() > stored.expires) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }

  try {
    const { error } = await supabase
      .from('users')
      .update({ password: newPassword })
      .eq('email', email);

    if (error) throw error;

    // Clear OTP
    otpStore.delete(email);

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Send order confirmation email
async function sendOrderConfirmationEmail(to, subject, orderData) {
  try {
    const templatePath = path.join(__dirname, 'order-confirmation.html');
    let html = fs.readFileSync(templatePath, 'utf8');

    // Replace placeholders
    html = html.replace(/{{name}}/g, orderData.name);
    html = html.replace(/{{orderId}}/g, orderData.orderId);
    html = html.replace(/{{orderDate}}/g, orderData.orderDate);
    html = html.replace(/{{address}}/g, orderData.address);
    html = html.replace(/{{city}}/g, orderData.city);
    html = html.replace(/{{state}}/g, orderData.state);
    html = html.replace(/{{pincode}}/g, orderData.pincode);
    html = html.replace(/{{phone}}/g, orderData.phone);
    html = html.replace(/{{total}}/g, orderData.total);
    html = html.replace(/{{items}}/g, orderData.itemsHtml);

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: to,
      subject: subject,
      html: html,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Order confirmation email sent to ${to}`);
  } catch (error) {
    console.error('Error sending order confirmation email:', error);
  }
}

// Helper functions
function generateInvoice(orderId, cart, total, shippingInfo) {
  let invoice = `Invoice for Order: ${orderId}\n\n`;
  invoice += `Shipping Info:\n`;
  invoice += `Name: ${shippingInfo.name}\n`;
  invoice += `Address: ${shippingInfo.address}, ${shippingInfo.city}, ${shippingInfo.state} - ${shippingInfo.pincode}\n`;
  invoice += `Phone: ${shippingInfo.phone}\n\n`;

  invoice += `Items:\n`;
  cart.forEach(item => {
    invoice += `${item.name} - ₹${item.price} x ${item.qty} = ₹${item.price * item.qty}\n`;
  });

  invoice += `\nTotal: ₹${total}\n`;

  return invoice;
}



app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
