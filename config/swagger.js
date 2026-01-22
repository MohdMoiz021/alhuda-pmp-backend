// config/swagger.js
const swaggerJSDoc = require('swagger-jsdoc');

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'CRM Backend API',
    version: '1.0.0',
    description: 'CRM Backend API Documentation',
    contact: {
      name: 'Your Name',
      email: 'your-email@example.com',
    },
  },
  servers: [
    {
      url: 'http://localhost:5000',
      description: 'Development server',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
};

const options = {
  swaggerDefinition,
  apis: [
    './src/routes/*.js',           
    './src/routes/**/*.js',       
    './src/controllers/*.js',     
  ],
};

const swaggerSpec = swaggerJSDoc(options);


console.log('Swagger files being parsed:', options.apis);

module.exports = swaggerSpec;