import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { createClient } from "redis";
import prisma from "../db/db";
import { CreatePresentation } from "../zod/presentation";
import { REDIS_URL } from "../config";

const redisClient = createClient({
  url: REDIS_URL || "redis://localhost:6379",
});

(async ()=> {
    await redisClient.connect();
})();

redisClient.on("error",(err)=> console.log("Redis Client Error:",err));

export const createPresentation = async (req:Request,res:Response) => {
    try {
      const result = CreatePresentation.safeParse(req.body);
      if(!result.success) {
        res.status(400).json({
            message:"Wrong inputs,zod validation failed"
        })
        return
      };

      const {prompt,userId} = result.data;
      const jobId = uuidv4();

      const job = await prisma.presentationJob.create({
        data: {
            id: jobId,
            prompt,
            userId,
            status: "PENDING"
        }
      });

      await redisClient.lPush("presentation_Task_queue", JSON.stringify({
        job_id: jobId,
        prompt: prompt
      }));

      res.status(200).json({
        message:"Presentation Generated Successfully",
        jobId,
        job,
        status:"PENDING"
      });
     
      return;

    } catch (error:any) {
        console.log("Error: ",error.message);
        res.status(500).json({
            message:"Internal Server Error"
        })
        return
    }
};


export const getPresentationStatus = async (req: Request, res: Response) => {
    try {
      const { jobId } = req.params;
      
      const job = await prisma.presentationJob.findUnique({
        where: {
          id: jobId,
        }
      });

      if (!job) {
        res.status(404).json({
          message: "Presentation job not found"
        });
        return
      }

      const status = await redisClient.get(`job_status:${jobId}`);
      
    const statusValue = status ? status.toUpperCase() : "PENDING";

    if (statusValue === "COMPLETED" || statusValue === "FAILED" || statusValue === "PENDING") {
      if (job.status !== statusValue) {
        await prisma.presentationJob.update({
          where: {
            id: jobId,
          },
          data: {
            status: statusValue as any 
          }
        });
      }
    }    res.status(200).json({
        jobId,
        status: statusValue || "PENDING"
      });
      return
    } catch (error:any) {
       res.status(500).json({
        message: "Failed to get presentation status",
        error:error.message
      });
      return
    }
  };

  export const getPresentation = async (req: Request, res: Response) => {
    try {
      const { jobId } = req.params;

      const job = await prisma.presentationJob.findUnique({
        where: {
          id: jobId,
        }
      });

      if (!job) {
        res.status(404).json({
          message: "Presentation job not found"
        });
        return
      }

      
      const presentation = await redisClient.get(`presentation:${jobId}`);
      if (!presentation) {
         res.status(404).json({
          message: "Presentation not found or still processing"
        });
        return
      }

      const status = await redisClient.get(`job_status:${jobId}`);
      
      const statusValue = status ? status.toUpperCase() : "PENDING";
  
      if (statusValue === "COMPLETED" || statusValue === "FAILED" || statusValue === "PENDING") {
        if (job.status !== statusValue) {
          await prisma.presentationJob.update({
            where: {
              id: jobId,
            },
            data: {
              status: statusValue as any 
            }
          });
        }
      } 
      
        res.status(200).json({
        jobId,
        presentation: JSON.parse(presentation)
      });
      return
    } catch (error:any) {
       res.status(500).json({
        message: "Failed to retrieve presentation",
        error:error.message
      });
      return
    }
  };