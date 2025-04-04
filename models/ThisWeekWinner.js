const { DataTypes } = require('sequelize');
const sequelize = require('../config/db_config'); 

const ThisWeekWinner = sequelize.define('ThisWeekWinner', {
  telegram_id: {
    type: DataTypes.BIGINT,
    primaryKey: true
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
  web_username: {
    type: DataTypes.STRING,
    allowNull: false
  }
}, {
  tableName: 'this_week_winners',
  timestamps: false
});

module.exports = ThisWeekWinner;
