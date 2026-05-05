const { Router } = require('express');
const {
  getLeads, getLead, createLead, updateLead, deleteLead,
  importLeads, assignLeads, upload,
} = require('../controllers/leadsController');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = Router();

// Static routes BEFORE dynamic :id
router.post('/import', authenticate, requireAdmin, upload.single('file'), importLeads);
router.post('/assign', authenticate, requireAdmin, assignLeads);

router.get('/',    authenticate, getLeads);
router.post('/',   authenticate, createLead);
router.get('/:id', authenticate, getLead);
router.put('/:id', authenticate, updateLead);
router.delete('/:id', authenticate, requireAdmin, deleteLead);

module.exports = router;
