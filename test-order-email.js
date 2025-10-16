const axios = require('axios');

async function testOrderEmail() {
  try {
    // Use a test user email
    const userEmail = 'testuser@example.com';

    // First, register a user if not exists
    try {
      await axios.post('http://localhost:3000/api/register', {
        name: 'Test User',
        email: userEmail,
        password: 'testpassword'
      });
      console.log('User registered');
    } catch (e) {
      console.log('User may already exist');
    }

    // Login to get user ID
    const loginResponse = await axios.post('http://localhost:3000/api/login', {
      email: userEmail,
      password: 'testpassword'
    });
    console.log('Login successful');

    if (!loginResponse.data.user) {
      console.error('Login failed: Invalid credentials');
      return;
    }

    const userId = loginResponse.data.user.id;

    // Place an order
    const orderResponse = await axios.post('http://localhost:3000/api/order', {
      userId,
      email: userEmail,
      cart: [
        { name: 'Crystal Necklace', price: 500, qty: 1 },
        { name: 'Crystal Bracelet', price: 300, qty: 2 }
      ],
      total: 1100,
      shippingInfo: {
        name: 'Test User',
        address: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        pincode: '123456',
        phone: '1234567890'
      }
    });
    console.log('Order placed:', orderResponse.data);

    console.log('Check emails for order confirmation. User email:', userEmail, 'Owner email: crystalloom9@gmail.com');
  } catch (error) {
    console.error('Error:', error.response ? error.response.data : error.message);
  }
}

testOrderEmail();
