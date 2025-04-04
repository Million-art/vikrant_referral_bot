const { DataTypes } = require('sequelize');
const sequelize = require('../config/db_config'); 

const WeekTracker = sequelize.define('WeekTracker', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  current_week: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1
  },
  start_date: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'week_tracker',
  timestamps: true
});

module.exports = WeekTracker; 