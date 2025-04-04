const User = require('../models/User');
const { sendReferralLink } = require('./referralService');
const { isUserMemberOfChannel } = require('../helper/channel');
const { joinChannelMarkup } = require('../helper/keyboard');
const Referral = require('../models/Referral');
const sequelize = require('../config/db_config');
const { Op } = require('sequelize');
const {REFERRAL_COUNT} = require("../constants");

  const registerUser= async (ctx) => {
    const userId = ctx.from.id;
    
    try {
      const [user] = await User.findOrCreate({
        where: { telegram_id: userId },
        defaults: { 
            first_name: ctx.from.first_name || 'Unknown',
            username:ctx.from.username
         }
      });

      const isMember = await isUserMemberOfChannel(ctx, userId);
      return isMember 
        ? sendReferralLink(ctx) 
        : ctx.reply('Please join our channel:', joinChannelMarkup);
        
    } catch (error) {
      console.error('Registration error:', error);
      await ctx.reply("Registration failed. Please try again.");
    }
  }

  const isUserAlreadyRegistered= async (userId) => {
    try {
      return await User.findByPk(userId) !== null;
    } catch (error) {
      console.error('Registration check error:', error);
      return false;
    }
  }

  const countMyWeeklyReferrals = async (ctx, loadingMessageId) => {
    try {
      const userId = ctx.from.id;
  
      const newReferralCondition = {
        referral_status: 'new'
      };
  
      const newReferralsCount = await Referral.count({
        where: {
          telegram_id: userId,
          ...newReferralCondition
        }
      });
  
      const allReferrals = await Referral.findAll({
        attributes: [
          'telegram_id',
          [sequelize.fn('COUNT', sequelize.col('referred_id')), 'referral_count']
        ],
        where: newReferralCondition,
        group: ['telegram_id'],
        order: [[sequelize.literal('referral_count'), 'DESC']]
      });
  
      const userPosition = allReferrals.findIndex(
        ref => ref.telegram_id === userId
      ) + 1;
  
      const position = userPosition > 0 ? userPosition : "Not ranked";
  
      const message = `
  📊 Your Referral Stats:
  
  👥 Your This round referrals: ${newReferralsCount}
  🏅 Your rank (by new referrals): ${position}
  
  Keep sharing your link to climb the leaderboard!
      `;
  
      // Delete the loading message
      if (loadingMessageId) {
        await ctx.deleteMessage(loadingMessageId);
      }
  
      await ctx.reply(message);
      if (ctx.callbackQuery) await ctx.answerCbQuery();
  
    } catch (error) {
      console.error('Error counting referrals:', error);
  
      if (loadingMessageId) {
        await ctx.deleteMessage(loadingMessageId).catch(() => {});
      }
  
      await ctx.reply("❌ Error occurred. Please try again.");
      if (ctx.callbackQuery) await ctx.answerCbQuery();
    }
  };
  

  const getCurrentLeaderboard = async (ctx) => {
    try {
      // Get top 3 referrers with non-'end' status referrals
      const leaders = await Referral.findAll({
        attributes: [
          'telegram_id',
          [sequelize.fn('COUNT', sequelize.col('id')), 'referral_count']
        ],
        where: {
          referral_status: {
            [Op.ne]: 'end'
          }
        },
        include: [{
          model: User,
          attributes: ['first_name'],
          required: true
        }],
        group: ['telegram_id', 'User.telegram_id'],  
        order: [[sequelize.literal('referral_count'), 'DESC']],
        limit: 3
      });
  
      return leaders.map(leader => ({
        first_name: leader.User?.first_name || 'Anonymous',
        referral_count: leader.get('referral_count')
      }));
    } catch (error) {
      console.error('Leaderboard error:', error);
      await ctx.reply("❌ Error loading leaderboard data");
      return [];
    }
  };
  module.exports = {
    registerUser,
    isUserAlreadyRegistered,
    sendReferralLink,
    countMyWeeklyReferrals,
    getCurrentLeaderboard
  };