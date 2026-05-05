const { Router } = require('express');
const { getStats, getSetterLeaderboard } = require('../controllers/dashboardController');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = Router();

router.get('/stats',       authenticate, getStats);
router.get('/leaderboard', authenticate, requireAdmin, getSetterLeaderboard);

module.exports = router;
