import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import driverPlansRouter from "./driver-plans";
import driversRouter from "./drivers";
import ordersRouter from "./orders";
import devRouter from "./dev";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(driverPlansRouter);
router.use(driversRouter);
router.use(ordersRouter);
router.use(devRouter);

export default router;
