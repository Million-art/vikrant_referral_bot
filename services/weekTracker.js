const WeekTracker = require('../models/WeekTracker');

async function getCurrentWeek() {
  try {
    // Get or create the week tracker
    const [tracker] = await WeekTracker.findOrCreate({
      where: { id: 1 },
      defaults: {
        current_week: 1,
        start_date: new Date()
      }
    });
    
    return tracker.current_week;
  } catch (error) {
    console.error('Error getting current week:', error);
    return 1; // Default to week 1 if there's an error
  }
}

async function incrementWeek() {
  try {
    const tracker = await WeekTracker.findByPk(1);
    if (tracker) {
      tracker.current_week += 1;
      tracker.start_date = new Date();
      await tracker.save();
      return tracker.current_week;
    }
    return 1;
  } catch (error) {
    console.error('Error incrementing week:', error);
    return 1;
  }
}

async function resetWeek() {
  try {
    const tracker = await WeekTracker.findByPk(1);
    if (tracker) {
      tracker.current_week = 1;
      tracker.start_date = new Date();
      await tracker.save();
    }
    return 1;
  } catch (error) {
    console.error('Error resetting week:', error);
    return 1;
  }
}

module.exports = {
  getCurrentWeek,
  incrementWeek,
  resetWeek
}; 