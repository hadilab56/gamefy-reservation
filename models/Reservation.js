const mongoose = require('mongoose');

const reservationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Customer name is required'],
    trim: true
  },
  phone: {
    type: String,
    trim: true,
    default: ''
  },
  date: {
    type: Date,
    required: [true, 'Reservation date is required']
  },
  arrivalTime: {
    type: String,
    required: [true, 'Arrival time is required']
  },
  leavingTime: {
    type: String,
    default: ''
  },
  duration: {
    type: String,
    default: ''
  },
  stations: {
    type: [String],
    default: []
  },
  stationType: {
    type: String,
    enum: ['pc', 'vip'],
    default: 'pc'
  },
  notes: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'active', 'done', 'cancelled'],
    default: 'pending'
  }
}, {
  timestamps: true
});

// Index for common queries
reservationSchema.index({ date: 1, status: 1 });
reservationSchema.index({ name: 'text', phone: 'text', notes: 'text' });

module.exports = mongoose.model('Reservation', reservationSchema);
