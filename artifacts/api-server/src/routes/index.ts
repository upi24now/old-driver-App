import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import driverPlansRouter from "./driver-plans";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(driverPlansRouter);

export default router;
