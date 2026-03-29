const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongodb:27017/orderdb';
mongoose.connect(MONGO_URI).then(() => console.log('Order Service: MongoDB connected')).catch(err => console.error(err));

const orderSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  items: [{
    productId: String,
    name: String,
    image: String,
    price: Number,
    quantity: Number,
    size: String,
    color: String
  }],
  totalAmount: { type: Number, required: true },
  shippingAddress: {
    name: String,
    address: String,
    city: String,
    state: String,
    zipCode: String,
    phone: String
  },
  deliveryType: { type: String, enum: ['express', 'normal'], default: 'normal' },
  deliveryFee: { type: Number, default: 0 },
  estimatedDelivery: { type: Date },
  status: { type: String, enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'], default: 'pending' },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
  paymentId: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'order-service' }));

// Create order
app.post('/orders', async (req, res) => {
  try {
    const { userId, items, shippingAddress, deliveryType = 'normal' } = req.body;
    const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const deliveryFee = deliveryType === 'express' ? 14.99 : 4.99;
    const deliveryDays = deliveryType === 'express' ? 2 : 5;
    const estimatedDelivery = new Date(Date.now() + deliveryDays * 24 * 60 * 60 * 1000);

    const order = await Order.create({
      userId, items, totalAmount: totalAmount + deliveryFee,
      shippingAddress, deliveryType, deliveryFee, estimatedDelivery
    });

    // Deduct stock from product-service and inventory-service
    const axios = require('axios');
    const PRODUCT_SERVICE = process.env.PRODUCT_SERVICE_URL || 'http://product-service:3003';
    const INVENTORY_SERVICE = process.env.INVENTORY_SERVICE_URL || 'http://inventory-service:3005';

    for (const item of items) {
      // Deduct from product-service
      axios.get(`${PRODUCT_SERVICE}/products/${item.productId}`)
        .then(resp => {
          const currentStock = resp.data.stock || 0;
          const newStock = Math.max(0, currentStock - item.quantity);
          return axios.put(`${PRODUCT_SERVICE}/products/${item.productId}`, { stock: newStock });
        })
        .catch(e => console.error('Product stock update failed:', e.message));

      // Deduct from inventory-service
      axios.get(`${INVENTORY_SERVICE}/inventory/${item.productId}`)
        .then(resp => {
          const currentStock = resp.data.stock || 0;
          const newStock = Math.max(0, currentStock - item.quantity);
          return axios.put(`${INVENTORY_SERVICE}/inventory/${item.productId}`, { stock: newStock });
        })
        .catch(e => console.error('Inventory stock update failed:', e.message));
    }

    res.status(201).json({ message: 'Order created', order });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get user orders
app.get('/orders/:userId', async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.params.userId }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get order details
app.get('/orders/detail/:orderId', async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update order status
app.put('/orders/:orderId/status', async (req, res) => {
  try {
    const { status, paymentStatus, paymentId } = req.body;
    const update = { updatedAt: Date.now() };
    if (status) update.status = status;
    if (paymentStatus) update.paymentStatus = paymentStatus;
    if (paymentId) update.paymentId = paymentId;
    const order = await Order.findByIdAndUpdate(req.params.orderId, update, { new: true });
    
    // Process invoice and shipping asynchronously when paid
    if (status === 'confirmed' && paymentStatus === 'paid') {
      const axios = require('axios');
      // Generate Invoice
      axios.post('http://invoice-service:3010/invoices/generate', { 
        orderId: order._id, userId: order.userId 
      }).catch(e => console.error('Invoice generation failed:', e.message));
      
      // Create Shipping Item
      axios.post('http://shipping-service:3011/shipping', {
        orderId: order._id, userId: order.userId, 
        estimatedDelivery: order.estimatedDelivery, 
        shippingAddress: order.shippingAddress
      }).catch(e => console.error('Shipping generation failed:', e.message));
    }

    res.json({ message: 'Order updated', order });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get all orders (admin)
app.get('/orders', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    const orders = await Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(Number(limit));
    const total = await Order.countDocuments(filter);
    res.json({ orders, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cancel order
app.put('/orders/:orderId/cancel', async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.orderId, { status: 'cancelled', updatedAt: Date.now() }, { new: true });
    res.json({ message: 'Order cancelled', order });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3008;
app.listen(PORT, () => console.log(`Order Service running on port ${PORT}`));
