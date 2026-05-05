const logger = require('../config/logger');

const errorHandler = (err, req, res, next) => {
  logger.error(err.message, { stack: err.stack, path: req.path, method: req.method });

  // Validation errors from express-validator
  if (err.type === 'validation') {
    return res.status(400).json({ message: 'Données invalides', errors: err.errors });
  }

  // PostgreSQL unique constraint violation
  if (err.code === '23505') {
    const field = err.detail?.match(/\(([^)]+)\)/)?.[1] || 'champ';
    return res.status(409).json({ message: `Cette valeur existe déjà : ${field}` });
  }

  // PostgreSQL foreign key violation
  if (err.code === '23503') {
    return res.status(400).json({ message: 'Référence invalide' });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ message: 'Non authentifié' });
  }

  // Multer file size error
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ message: 'Fichier trop volumineux (max 10 Mo)' });
  }

  // Default 500
  const isDev = process.env.NODE_ENV === 'development';
  res.status(err.status || 500).json({
    message: err.message || 'Erreur serveur interne',
    ...(isDev && { stack: err.stack }),
  });
};

module.exports = errorHandler;
