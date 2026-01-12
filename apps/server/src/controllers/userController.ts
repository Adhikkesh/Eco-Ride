import type { RequestHandler } from "express";
import status from "http-status";

interface CreateUserBody {
  name: string;
  role: "driver" | "rider";
}

export const CreateUserController: RequestHandler<object, object, CreateUserBody> = (req, res) => {
  const { name, role } = req.body;
  const firebaseUser = req.user;

  if (!firebaseUser) {
    return res
      .status(status.UNAUTHORIZED)
      .json({ message: "Unauthorized: User not authenticated" });
  }

  if (!name || !role) {
    return res
      .status(status.BAD_REQUEST)
      .json({ message: "Bad Request: name and role are required" });
  }

  // TODO: Save user to database
  // For now, return the user data that would be saved
  const userData = {
    createdAt: new Date().toISOString(),
    email: firebaseUser.email,
    name,
    role,
    uid: firebaseUser.uid,
  };

  res.status(status.CREATED).json({
    data: userData,
    message: "User created successfully",
  });
};
