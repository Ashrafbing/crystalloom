// Simple discount function
function getDiscountPercent(productId) {
  // Fixed discount based on product ID: higher ID, higher discount
  return 0.1 + (productId * 0.02); // Starts at 10%, increases by 2% per ID
}

function getDiscountedPrice(product, productId) {
  let discountPercent;
  if (product.discount !== undefined) {
    discountPercent = product.discount / 100; // Assuming discount is in percentage
  } else {
    discountPercent = getDiscountPercent(productId);
  }
  return Math.round(product.price * (1 - discountPercent));
}

function formatPriceDisplay(original, discounted) {
  const discountPercent = Math.round(((original - discounted) / original) * 100);
  return `<span class="price-original">₹${original}</span> <span class="price-discounted">₹${discounted}</span> <span class="discount-percent">(${discountPercent}% off)</span>`;
}

// Products data with IDs and base prices
const productsData = [
  { id: 1, name: 'Crystal Bracelet', price: 3999},
  { id: 2, name: 'Gemstone Necklace', price: 6499 },
  { id: 3, name: 'Elegant Ring', price: 4999 },
  { id: 4, name: 'Crystal Earrings', price: 2999 },
  { id: 5, name: 'Healing Pendant', price: 3499 },
  { id: 6, name: 'Crystal Choker', price: 5999 },
  { id: 7, name: 'Royal Emerald Ring', price: 7999 },
  { id: 8, name: 'Diamond Stud Earrings', price: 9999 },
  { id: 9, name: 'Pearl Necklace', price: 5499 } // Assuming this exists
];

// Function to get product by ID
function getProductById(id) {
  return productsData.find(p => p.id == id);
}

// Function to get discounted price for a product ID
function getDiscountedPriceById(id) {
  const product = getProductById(id);
  if (product) {
    return getDiscountedPrice(product, id);
  }
  return 0;
}
