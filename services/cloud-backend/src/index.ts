import express from 'express';
import cors from 'cors';
import { apiRouter } from './routes/api';
import { workerRouter } from './routes/worker';

const app = express();
const PORT = Number(process.env.PORT) || 8080;

app.use(cors());
app.use(express.json());

// API routes for client control
app.use('/', apiRouter);

// Worker routes for 20s tick scheduler
app.use('/', workerRouter);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Predict GCP Cloud Backend running on 0.0.0.0:${PORT}`);
  });
}

export { app };
