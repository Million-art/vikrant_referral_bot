const { DataTypes } = require('sequelize');
const sequelize = require('../config/db_config'); 

const WeeklyWinner = sequelize.define('WeeklyWinner', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  week_number: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  telegram_id: {
    type: DataTypes.BIGINT,
    allowNull: false
  },
  first_name: {
    type: DataTypes.STRING,
    allowNull: false
  },

  referral_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  website: {
    type: DataTypes.ENUM('winfix.live', 'autoexch.live', 've567.live', 've777.club', 'vikrant247.com'),
    allowNull: false
  },
  web_username:{
    type: DataTypes.STRING,
    allowNull: false
  }
}, {
  tableName: 'weekly_winners',
  timestamps: false,
  indexes: [
    { unique: true, fields: ['week_number', 'telegram_id'] },
    { fields: ['week_number'] }
  ]
});

module.exports = WeeklyWinner;
