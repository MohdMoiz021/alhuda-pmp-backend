const jwt = require("jsonwebtoken");
const User = require("../models/user.model");

// SIGNUP
exports.signup = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({ 
        message: "Name, email, and password are required" 
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        message: "Invalid email format" 
      });
    }

    // Check if user exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(409).json({ 
        message: "User with this email already exists" 
      });
    }

    // Create user
    const newUser = await User.create({ name, email, password });

    // Generate token
    const token = jwt.sign(
      { 
        userId: newUser.id,
        email: newUser.email,
        role: newUser.role
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      message: "User registered successfully",
      token,
      user: newUser
    });

  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ 
      message: "Server error during registration"
    });
  }
};

// LOGIN
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ 
        message: "Email and password are required" 
      });
    }

    // Find user
    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(401).json({ 
        message: "Invalid email or password" 
      });
    }

    // Check if active
    if (!user.is_active) {
      return res.status(403).json({ 
        message: "Account is deactivated" 
      });
    }

    // Verify password
    const isMatch = await User.verifyPassword(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ 
        message: "Invalid email or password" 
      });
    }

    // Update last login
    await User.updateLastLogin(user.id);

    // Generate token
    const token = jwt.sign(
      { 
        userId: user.id,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Remove password from response
    const { password_hash, ...userWithoutPassword } = user;

    res.json({ 
      message: "Login successful",
      token,
      user: userWithoutPassword
    });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ 
      message: "Server error during login"
    });
  }
};

// GET PROFILE
exports.getProfile = async (req, res) => {
  try {
    // Use req.userId (set by your middleware) instead of req.user.userId
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({ 
        message: "User not found" 
      });
    }

    res.json({ user });

  } catch (err) {
    console.error("Get profile error:", err);
    res.status(500).json({ 
      message: "Server error"
    });
  }
};