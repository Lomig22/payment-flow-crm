const { Router } = require('express');
const { getUsers, getUser, createUser, updateUser, deleteUser, getUserPerformance } = require('../controllers/usersController');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = Router();

router.get('/',                  authenticate, requireAdmin, getUsers);
router.post('/',                 authenticate, requireAdmin, createUser);
router.get('/:id',               authenticate, getUser);
router.put('/:id',               authenticate, updateUser);
router.delete('/:id',            authenticate, requireAdmin, deleteUser);
router.get('/:id/performance',   authenticate, getUserPerformance);

module.exports = router;
