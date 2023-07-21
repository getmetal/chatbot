import { NextApiRequest, NextApiResponse } from "next";


export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  const isPwProtected = process.env.DEMO_PW !== undefined;
  if (!isPwProtected) {
    return res.status(404).json({ check: isPwProtected });
  }

  return res.status(200).json({ check: isPwProtected });
}
