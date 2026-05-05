const { Router } = require('express');
const { getTags, createTag, updateTag, deleteTag } = require('../controllers/tagsController');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = Router();

router.get('/',     authenticate, getTags);
router.post('/',    authenticate, requireAdmin, createTag);
router.put('/:id',  authenticate, requireAdmin, updateTag);
router.delete('/:id', authenticate, requireAdmin, deleteTag);

module.exports = router;
