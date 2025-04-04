const { sequelize } = require("../config/db_config");
const { ADMIN, CHANNEL_ID } = require("../constants");
const WeeklyWinner = require("../models/WeeklyWinner");
const ThisWeekWinner = require("../models/ThisWeekWinner");
const Referral = require("../models/Referral");
const { getCurrentWeek } = require("./weekTracker");

async function archiveCurrentWeek(transaction) {
  try {
    const weekNumber = await getCurrentWeek();
    const winners = await ThisWeekWinner.findAll({ transaction });

    // Archive all winners regardless of count
    if (winners.length > 0) {
      await WeeklyWinner.bulkCreate(
        winners.map(winner => ({
          week_number: weekNumber,
          telegram_id: winner.telegram_id,
          first_name: winner.first_name,
          website: winner.website,
          web_username: winner.web_username,
          referral_count: winner.referral_count
        })),
        { transaction }
      );
    }

    return weekNumber;
  } catch (error) {
    console.error('Error in archiveCurrentWeek:', error);
    throw error;
  }
}

async function addWinnerToThisWeekTable(ctx, validReferralCount, website, username) {
  const userId = ctx.from.id;
  const userFirstName = ctx.from.first_name;

  if (!website || !username) {
    ctx.reply("Website and username are required.");
    return;
  }

  try {
    // Check if user already exists in this week's winners
    const [winner, created] = await ThisWeekWinner.findOrCreate({
      where: { telegram_id: userId },
      defaults: {
        first_name: userFirstName,
        website: website,
        web_username: username,
        referral_count: validReferralCount  
      }
    });

    if (!created) {
      // If user already existed, update their record
      await winner.update({ 
        website: website,
        web_username: username,
        referral_count: validReferralCount 
      }); 
      console.log(`Updated winner record for user ${userId}`);
    }

    const responseMessage = validReferralCount > 0
      ? `✅ Success! Your ${website} username "${username}" has been recorded with ${validReferralCount} valid referrals.`
      : "⚠️ You currently have no valid referrals this week.";

    await ctx.reply(responseMessage);

    return true;

  } catch (error) {
    console.error("Error in addWinnerToThisWeekTable:", error);
    await ctx.reply("❌ There was an issue processing your submission. Please try again later.");
    await ctx.telegram.sendMessage(
      ADMIN, 
      `Error processing winner submission:\n` +
      `User: ${userFirstName} (${userId})\n` +
      `Error: ${error.message}`
    );
    return false;
  }
}

module.exports = {
  archiveCurrentWeek,
  addWinnerToThisWeekTable
};