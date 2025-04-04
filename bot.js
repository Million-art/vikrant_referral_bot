require("dotenv").config();
const { Telegraf } = require("telegraf");
const bot = new Telegraf(process.env.BOT_TOKEN);
const { addWinnerToThisWeekTable, archiveCurrentWeek } = require("./services/weeklyFunctions.js");
const { isUserMemberOfChannel } = require("./helper/channel.js");
const { isUserAlreadyRegistered, registerUser, countMyWeeklyReferrals, getCurrentLeaderboard } = require("./services/user.js");
const { regUserWithReferralNumber } = require("./services/referralService.js");
const { ADMIN, MIN_REFERRAL_COUNT, WEEK_END_CAPTION, MONTH_END_CAPTION } = require("./constants.js");
const sequelize = require("./config/db_config.js");
const Referral = require("./models/Referral.js");
const ThisWeekWinner = require("./models/ThisWeekWinner.js");
const WeeklyWinner = require("./models/WeeklyWinner.js");
const setupAssociations = require('./models/index.js');
const MonthlyWinner = require("./models/MonthlyWinner.js");
const { clearMonthEndData, getMonthlyLeadersWithContact } = require("./services/MonthlyFunctions.js");
const { getCurrentWeek, incrementWeek, resetWeek } = require('./services/weekTracker');
const PDFDocument = require('pdfkit');

// Initialize state management
const pendingSelections = new Map();

bot.use(async (ctx, next) => {
  ctx.state = ctx.state || {};
  ctx.state.pendingSelections = pendingSelections;
  await next();
});

async function initializeDatabase() {
  try {
    await sequelize.authenticate();
    console.log('Database connected');
    await setupAssociations(sequelize);
    bot.launch();
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  }
}

initializeDatabase();

// Start command handler
bot.start(async (ctx) => {
  if (ctx.payload) {
    const referralNumber = ctx.payload;
    const isReferralIdValid = await isUserMemberOfChannel(ctx, Number(referralNumber));
    const isReferredUserAlreadyRegistered = await isUserAlreadyRegistered(Number(ctx.from.id));
    
    if (isReferralIdValid && !isReferredUserAlreadyRegistered) {
      await regUserWithReferralNumber(ctx, referralNumber);
      return;
    } else if (isReferredUserAlreadyRegistered) {
      ctx.reply("You have already registered, you cannot be referred");
      return;
    }
  }
  await registerUser(ctx);
});

// General callback handler - now properly passes control
bot.on("callback_query", async (ctx, next) => {
  console.log('Raw callback data:', ctx.callbackQuery.data);
  
  // Only handle specific cases
  if (ctx.callbackQuery.data === "get_my_referral") {
    await ctx.deleteMessage();
    await registerUser(ctx);
    return ctx.answerCbQuery("");
  } 
  else if (ctx.callbackQuery.data === "joined_channel") {
    await ctx.deleteMessage();
    await registerUser(ctx);
    return ctx.answerCbQuery("");
  } 
  else if (ctx.callbackQuery.data === "referred_users_number") {
    return countMyWeeklyReferrals(ctx);
  }
  
  // Pass all other callbacks to next handlers
  await next();
});

// Website selection handler
bot.action(/^website_(.+)$/, async (ctx) => {
  try {
    console.log('Website selection triggered:', ctx.match[1]);
    const website = ctx.match[1];
    const userId = ctx.from.id;
    
    // 1. Acknowledge callback
    await ctx.answerCbQuery(`Selected ${website}`);
    
    // 2. Try to delete original message
    try {
      await ctx.deleteMessage();
      console.log('Original message deleted');
    } catch (error) {
      console.log('Could not delete message (maybe too old)');
    }
    
    // 3. Store selection with more detailed logging
    const selection = {
      website: website,
      timestamp: Date.now(),
      userId: userId,
      userName: ctx.from.first_name
    };
    
    pendingSelections.set(userId, selection);
    console.log('Stored selection:', selection);
    
    // 4. Request username with force reply
    const reply = await ctx.reply(
      `🌐 You selected: ${website}\n\nPlease reply with your ${website} username:`,
      {
        reply_markup: {
          force_reply: true,
          selective: true,
          input_field_placeholder: `Your ${website} username`
        }
      }
    );
    
    // Store reply message ID for reference
    selection.replyMessageId = reply.message_id;
    pendingSelections.set(userId, selection);
    console.log('Updated selection with reply ID:', selection);
    
  } catch (error) {
    console.error('Website selection error:', error);
    await ctx.reply("❌ Failed to process selection. Please try again.");
  }
});

// Username submission handler
bot.on('message', async (ctx, next) => {
  try {
    console.log('--- New Message Received ---');
    console.log('From:', ctx.from.id, ctx.from.first_name);
    console.log('Text:', ctx.message.text);
    console.log('Is reply?', !!ctx.message.reply_to_message);
    console.log('Current pending selections:', Array.from(pendingSelections.entries()));
    
    const userId = ctx.from.id;
    const selection = pendingSelections.get(userId);
    
    // Skip if no pending selections
    if (!selection) {
      console.log('No pending selection for this user');
      return next();
    }
    
    // Skip if not a reply
    if (!ctx.message.reply_to_message) {
      console.log('Message is not a reply - ignoring');
      return next();
    }
    
    console.log('Pending selection found:', selection);
    
    // Verify this is the correct reply
    if (ctx.message.reply_to_message.message_id !== selection.replyMessageId) {
      console.log('Reply is not to our username request message');
      console.log('Expected message ID:', selection.replyMessageId);
      console.log('Actual reply to ID:', ctx.message.reply_to_message.message_id);
      return next();
    }
    
    const website = selection.website;
    const username = ctx.message.text.trim();
     
    if (!username || username.length > 50) {
      console.log('Invalid username format');
      await ctx.reply("⚠️ Username must be 1-50 characters. Please try again.");
      return;
    }
    
    // Get valid referral count for the user
    const referrals = await Referral.findAll({
      where: { 
        telegram_id: userId,
        referral_status: 'new'
      }
    });

    let validReferralCount = 0;
    for (const referral of referrals) {
      const mockCtx = { telegram: bot.telegram };
      const isMember = await isUserMemberOfChannel(mockCtx, referral.referred_id);
      if (isMember) {
        validReferralCount++;
      }
    }

    console.log('Adding to winners table...');
    const success = await addWinnerToThisWeekTable(ctx, validReferralCount, website, username);
    
    if (!success) {
      throw new Error('Failed to add to winners table');
    }
    
    console.log('Updating referral status...');
    await Referral.update(
      { referral_status: 'counted' },
      { where: { telegram_id: userId, referral_status: 'new' } }
    );
    
    console.log('Notifying admin...');
    await ctx.telegram.sendMessage(
      ADMIN,
      `🏆 New Winner\n` +
      `👤 ${ctx.from.first_name} (${validReferralCount} referrals)\n` +
      `🌐 ${website}\n` +
      `📛 ${username}`
    ).catch(err => console.error('Failed to notify admin:', err));
    
    console.log('Confirming to user...');
    await ctx.reply(`✅ Success! Your ${website} username has been recorded.`);
    
    console.log('Cleaning up state...');
    pendingSelections.delete(userId);
    console.log('--- Submission Complete ---');
    
  } catch (error) {
    console.error('SUBMISSION ERROR:', error);
    await ctx.reply("❌ Failed to process your username. Please try again or contact admin.");
  }
});

// Admin command to request usernames
bot.command('ask_username', async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN) {
    return ctx.reply("🚫 Only admin can use this command");
  }

  try {
    // Find eligible users
    const eligibleUsers = await Referral.findAll({
      attributes: ['telegram_id'],
      where: { referral_status: 'new' },
      group: ['telegram_id'],
      having: sequelize.literal(`COUNT(*) >= ${MIN_REFERRAL_COUNT}`),
    });

    if (eligibleUsers.length === 0) {
      return ctx.reply(`No users currently qualify (need ≥ ${MIN_REFERRAL_COUNT} new referrals)`);
    }

    // Validate referrals
    const validUsers = [];
    for (const user of eligibleUsers) {
      try {
        const isValidUser = await validateUserReferrals(user.telegram_id);
        if (isValidUser) {
          validUsers.push(user);
        }
      } catch (error) {
        console.error(`Failed to validate user ${user.telegram_id}:`, error);
      }
    }

    if (validUsers.length === 0) {
      return ctx.reply("No users currently qualify after validation");
    }

    // Send website selection to valid users
    for (const user of validUsers) {
      try {
        await ctx.telegram.sendMessage(
          user.telegram_id,
          "🎉 Congratulations! You've qualified for rewards!\n\n" +
          "Please select which website you're playing on:",
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "winfix.live", callback_data: "website_winfix.live" },
                  { text: "autoexch.live", callback_data: "website_autoexch.live" },
                ],
                [
                  { text: "ve567.live", callback_data: "website_ve567.live" },
                  { text: "ve777.club", callback_data: "website_ve777.club" },
                ],
                [
                  { text: "vikrant247.com", callback_data: "website_vikrant247.com" },
                ]
              ]
            }
          }
        );
      } catch (error) {
        console.error(`Failed to message user ${user.telegram_id}:`, error);
      }
    }

    await ctx.reply(`✅ Website selection sent to ${validUsers.length} eligible users`);
  } catch (error) {
    console.error('Error in ask_username:', error);
    await ctx.reply("❌ Failed to process command. Please try again.");
  }
});

// Validate user referrals
async function validateUserReferrals(telegramId) {
  try {
    const referrals = await Referral.findAll({
      where: { telegram_id: telegramId, referral_status: 'new' },
    });

    console.log(`Found ${referrals.length} referrals for user ${telegramId}`);

    if (referrals.length === 0) {
      console.log(`No referrals found for user ${telegramId}`);
      return false;
    }

    let validReferralCount = 0;

    for (const referral of referrals) {
      try {
        // Create a mock context object for the channel check
        const mockCtx = {
          telegram: bot.telegram
        };
        
        const isMember = await isUserMemberOfChannel(mockCtx, referral.referred_id);
        console.log(`User ${referral.referred_id} is member: ${isMember}`);

        if (isMember) {
          validReferralCount++;
        } else {
          // Mark non-members as 'end' status
          await Referral.update(
            { referral_status: 'end' },
            { where: { id: referral.id } }
          );
          console.log(`Marked referral ${referral.id} as 'end' - user left the channel`);
        }
      } catch (error) {
        console.error(`Error validating referral ${referral.id}:`, error);
        // Continue processing other referrals even if one fails
      }
    }

    console.log(`User ${telegramId} has ${validReferralCount} valid referrals`);
    return validReferralCount >= MIN_REFERRAL_COUNT;
  } catch (error) {
    console.error('Error validating user referrals:', error);
    return false;
  }
}

// Command: /end_week - Archives current week and prepares for new week
bot.command('end_week', async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN) {
    return ctx.reply("🚫 Only admin can end the week");
  }

  // Send processing message
  const processingMsg = await ctx.reply("⏳ Processing week closure... Please wait");
  
  const transaction = await sequelize.transaction();
  
  try {
    // Step 1: Get current winners and archive them
    const winners = await ThisWeekWinner.findAll({ transaction });
    const weekNumber = await getCurrentWeek();
    await archiveCurrentWeek(transaction);

    if (winners.length === 0) {
      await transaction.rollback();
      await ctx.telegram.editMessageText(
        processingMsg.chat.id,
        processingMsg.message_id,
        null,
        "ℹ️ No winners found this week - nothing to archive"
      );
      return;
    }

    // Step 2: Generate PDF file
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const doc = new PDFDocument();
    const chunks = [];

    // Collect PDF data
    doc.on('data', chunk => chunks.push(chunk));
    
    // Add header
    doc.fontSize(20)
       .text(`Week ${weekNumber} Winners Report`, { align: 'center' })
       .moveDown();
    
    doc.fontSize(12)
       .text(`Generated on: ${dateStr}`, { align: 'center' })
       .moveDown()
       .moveDown();

    // Add table header
    const startX = 50;
    let currentY = doc.y;
    
    // Draw table header
    doc.fontSize(12)
       .text('Rank', startX, currentY)
       .text('Name', startX + 50, currentY)
       .text('Website', startX + 200, currentY)
       .text('Username', startX + 350, currentY)
       .text('Referrals', startX + 450, currentY)
       .moveDown();

    // Draw header line
    doc.moveTo(startX, doc.y)
       .lineTo(startX + 500, doc.y)
       .stroke();
    
    doc.moveDown();

    // Add winners data
    winners.forEach((winner, index) => {
      const rank = index + 1;
      currentY = doc.y;
      
      // Handle empty or undefined first name
      const firstName = winner.first_name ? winner.first_name.trim() : '';
      
      doc.fontSize(11)
         .text(rank.toString(), startX, currentY)
         .text(firstName, startX + 50, currentY)
         .text(winner.website || '', startX + 200, currentY)
         .text(winner.web_username || '', startX + 350, currentY)
         .text(winner.referral_count.toString(), startX + 450, currentY)
         .moveDown();
    });

    // Draw bottom line
    doc.moveTo(startX, doc.y)
       .lineTo(startX + 500, doc.y)
       .stroke();

    // Add summary
    doc.moveDown()
       .fontSize(12)
       .text(`Total Winners: ${winners.length}`, { align: 'right' });

    // Finalize PDF
    doc.end();

    // Step 3: Update referral statuses
    await Referral.update(
      { referral_status: 'counted' },
      {
        where: { referral_status: 'new' },
        transaction
      }
    );

    // Step 4: Clear this week's data
    await ThisWeekWinner.destroy({
      truncate: true,
      transaction
    });

    // Step 5: Increment the week number
    const nextWeek = await incrementWeek();

    // Commit everything
    await transaction.commit();

    // Send success message
    await ctx.telegram.deleteMessage(processingMsg.chat.id, processingMsg.message_id);
    
    // Convert chunks to Buffer
    const pdfBuffer = Buffer.concat(chunks);
    
    // Send the PDF file
    await ctx.replyWithDocument({
      source: pdfBuffer,
      filename: `week_${weekNumber}_winners_${dateStr}.pdf`
    }, {
      caption: WEEK_END_CAPTION.replace('{weekNumber}', weekNumber) +
               `📊 ${winners.length} winners archived\n\n` +
               `📅 Starting Week ${nextWeek}\n\n` +
               `📋 Winners Summary:\n` +
               winners.map((w, i) => 
                 `${["🥇","🥈","🥉"][i] || "🏅"} ${w.first_name} - ${w.referral_count} referrals (${w.website})`
               ).join("\n")
    });

  } catch (error) {
    await transaction.rollback();
    
    // Update processing message with error
    await ctx.telegram.editMessageText(
      processingMsg.chat.id,
      processingMsg.message_id,
      null,
      "❌ Failed to process week: " + error.message
    );
    
    console.error("End week error:", error);
  }
});

// Command: /reset_week - Resets week number to 1
bot.command('reset_week', async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN) {
    return ctx.reply("🚫 Only admin can reset the week");
  }

  try {
    await resetWeek();
    await ctx.reply("✅ Week number has been reset to 1");
  } catch (error) {
    console.error('Error resetting week:', error);
    await ctx.reply("❌ Failed to reset week number");
  }
});

// Command: /current_week - Shows current week number
bot.command('current_week', async (ctx) => {
  try {
    const weekNumber = await getCurrentWeek();
    await ctx.reply(`📅 Current Week: ${weekNumber}`);
  } catch (error) {
    console.error('Error getting current week:', error);
    await ctx.reply("❌ Failed to get current week number");
  }
});

// Command: /end_month - Calculates monthly winners
bot.command('end_month', async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN) {
    return ctx.reply("🚫 Only admin can end the month");
  }

  // Send initial processing message
  const processingMsg = await ctx.reply("⏳ Starting monthly closure process...\n\nPlease wait, this may take a moment...");

  const transaction = await sequelize.transaction();

  try {
    // Update message to show data collection
    await ctx.telegram.editMessageText(
      processingMsg.chat.id,
      processingMsg.message_id,
      null,
      "⏳ Collecting monthly winner data...\n\nPlease wait..."
    );

    // Get all weekly winners for the month
    const weeklyWinners = await WeeklyWinner.findAll({
      attributes: [
        'telegram_id',
        'first_name',
        'website',
        'web_username',
        [sequelize.fn('SUM', sequelize.col('referral_count')), 'total_referrals']
      ],
      group: ['telegram_id', 'first_name', 'website', 'web_username'],
      order: [[sequelize.literal('total_referrals'), 'DESC']],
      transaction
    });
    
    if (weeklyWinners.length === 0) {
      await transaction.rollback();
      await ctx.telegram.editMessageText(
        processingMsg.chat.id,
        processingMsg.message_id,
        null,
        "ℹ️ No eligible winners this month\n\nNo data to archive."
      );
      return;
    }

    // Update message to show archiving status
    await ctx.telegram.editMessageText(
      processingMsg.chat.id,
      processingMsg.message_id,
      null,
      "⏳ Archiving monthly winners...\n\nAlmost done..."
    );

    const now = new Date();
    const monthYear = now.toLocaleString('default', { month: 'long', year: 'numeric' });
    
    // Generate PDF report
    const doc = new PDFDocument();
    const chunks = [];

    // Collect PDF data
    doc.on('data', chunk => chunks.push(chunk));
    
    // Add header
    doc.fontSize(20)
       .text(`Monthly Winners Report - ${monthYear}`, { align: 'center' })
       .moveDown();
    
    doc.fontSize(12)
       .text(`Generated on: ${now.toISOString().split('T')[0]}`, { align: 'center' })
       .moveDown()
       .moveDown();

    // Add table header
    const startX = 50;
    let currentY = doc.y;
    
    // Draw table header
    doc.fontSize(12)
       .text('Rank', startX, currentY)
       .text('Name', startX + 50, currentY)
       .text('Website', startX + 200, currentY)
       .text('Username', startX + 350, currentY)
       .text('Total Referrals', startX + 450, currentY)
       .moveDown();

    // Draw header line
    doc.moveTo(startX, doc.y)
       .lineTo(startX + 500, doc.y)
       .stroke();
    
    doc.moveDown();

    // Add winners data
    weeklyWinners.forEach((winner, index) => {
      const rank = index + 1;
      currentY = doc.y;
      
      // Handle empty or undefined first name
      const firstName = winner.first_name ? winner.first_name.trim() : '';
      
      doc.fontSize(11)
         .text(rank.toString(), startX, currentY)
         .text(firstName, startX + 50, currentY)
         .text(winner.website || '', startX + 200, currentY)
         .text(winner.web_username || '', startX + 350, currentY)
         .text(winner.get('total_referrals').toString(), startX + 450, currentY)
         .moveDown();
    });

    // Draw bottom line
    doc.moveTo(startX, doc.y)
       .lineTo(startX + 500, doc.y)
       .stroke();

    // Add summary
    doc.moveDown()
       .fontSize(12)
       .text(`Total Winners: ${weeklyWinners.length}`, { align: 'right' });

    // Finalize PDF
    doc.end();

    // Step 1: First truncate the monthly winners table
    await MonthlyWinner.destroy({
      truncate: true,
      transaction
    });

    // Step 2: Archive to MonthlyWinner
    await MonthlyWinner.bulkCreate(
      weeklyWinners.map(winner => ({
        month_year: monthYear,
        telegram_id: winner.telegram_id,
        first_name: winner.first_name,
        website: winner.website,
        web_username: winner.web_username,
        referral_count: winner.get('total_referrals')
      })),
      { transaction }
    );

    // Step 3: Clear weekly winners table
    await WeeklyWinner.destroy({
      truncate: true,
      transaction
    });

    // Step 4: Clear this week winners table
    await ThisWeekWinner.destroy({
      truncate: true,
      transaction
    });

    // Step 5: Update all referral statuses to 'end'
    await Referral.update(
      { referral_status: 'end' },
      {
        where: {
          referral_status: ['new', 'counted']
        },
        transaction
      }
    );

    // Step 6: Reset week number to 1
    await resetWeek();

    // Commit transaction
    await transaction.commit();

    // Delete processing message
    await ctx.telegram.deleteMessage(processingMsg.chat.id, processingMsg.message_id);
    
    // Convert chunks to Buffer
    const pdfBuffer = Buffer.concat(chunks);
    
    // Send the PDF report
    await ctx.replyWithDocument({
      source: pdfBuffer,
      filename: `weekly_winners_week${weekNumber}.pdf`
    }, {
      caption: `✅ Week ${weekNumber} successfully closed!\n` +
               `📊 ${weeklyWinners.length} winners this week\n\n` +
               `📋 Top Winners:\n` +
               weeklyWinners.slice(0, 3).map((w, i) => 
                 `${["🥇","🥈","🥉"][i]} ${w.first_name} - ${w.referral_count} referrals`
               ).join("\n")
    });

  } catch (error) {
    await transaction.rollback();
    console.error('Error in end_month:', error);
    await ctx.reply("❌ Failed to process command. Please try again.");
  }
});

// Command: /my_referral - Shows user's referral stats
bot.command('my_referral', async (ctx) => {
  try {
    // Send temporary message
    const loadingMessage = await ctx.reply("⏳ Checking your referral stats...");

    // Call the stats function and pass the loading message
    await countMyWeeklyReferrals(ctx, loadingMessage.message_id);
  } catch (err) {
    console.error("Error sending referral stats:", err);
    await ctx.reply("❌ Something went wrong.");
  }
});

// Command: /rules - Shows rules and regulations
bot.command('rules', async (ctx) => {
  const rulesMessage = `
📜 *Rules and Regulations for Referral System*

1. *Referral Process*
   - Share your unique referral link with friends
   - Friends must join the channel through your link
   - Friends must remain in the channel to count as valid referrals

2. *Valid Referrals*
   - Only users who are active members of the channel count
   - If a referred user leaves the channel, they no longer count
   - You cannot refer yourself
   - Each user can only be referred once

3. *Qualification Requirements*
   - Minimum ${MIN_REFERRAL_COUNT} valid referrals required to qualify
   - All referrals must be active channel members
   - Referrals are validated when you submit your username

4. *Reward Process*
   - Once you qualify, you'll be asked to select your website
   - Provide your correct username for the selected website
   - Rewards are processed after validation

  `;

  await ctx.reply(rulesMessage, { parse_mode: 'Markdown' });
});

// Command: /leaderboard - Shows current monthly leaders
bot.command('leaderboard', async (ctx) => {
  try {
    // Show typing indicator
    await ctx.sendChatAction('typing');
    
    // Get top 3 leaders
    const leaders = await getCurrentLeaderboard(ctx);
    
    if (leaders.length === 0) {
      return ctx.reply("No active referrals yet. Be the first to refer someone!");
    }

    // Build simple leaderboard message
    let message = "🏆 Top 3 Referrers:\n\n";
    const medals = ["🥇", "🥈", "🥉"];
    
    leaders.slice(0, 3).forEach((leader, index) => {
      message += `${medals[index]} ${leader.first_name} - ${leader.referral_count} referrals\n`;
    });

    await ctx.reply(message);

  } catch (error) {
    console.error("Leaderboard error:", error);
    await ctx.reply("Failed to load leaderboard. Please try again later.");
  }
});