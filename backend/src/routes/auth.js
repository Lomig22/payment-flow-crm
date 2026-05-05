const { Router } = require('express');
const { login, me, logout, changePassword } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

const router = Router();

router.post('/login',           login);
router.get('/me',               authenticate, me);
router.post('/logout',          authenticate, logout);
router.put('/change-password',  authenticate, changePassword);

module.exports = router;
