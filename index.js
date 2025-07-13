require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const admin = require("firebase-admin");

const port = process.env.PORT || 5000;

const stripe = require("stripe")(`${process.env.PAYMENT_GATEWAY_KEY}`);

const serviceAccount = require("./Firebase-admin-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Middleware
app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, Admin } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@jhank.0gkcofh.mongodb.net/?retryWrites=true&w=majority&appName=Jhank`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
const { ObjectId } = require("mongodb");

// custome middleware
const verifyFBToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "unauthorizes access" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).send({ message: "unauthorization access" });
  }
  // Verify The Token
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded = decoded;
    next();
  } catch (error) {
    return res.status(403).send({ message: "forbidden access" });
  }
};

const db = client.db("parcelcollection");
const userCollection = db.collection("users");
const parcelCollection = db.collection("parcel");
const paymentCollection = db.collection("payments");
const riderCollection = db.collection("riders");

// Verify Admin
const verifyAdmin = async (req, res, next) => {
  const email = req.decoded.email;
  const query = { email };
  const user = await userCollection.findOne(query);
  if (!user || user.role !== "admin") {
    return res.status(403).send({ message: "forbidden access" });
  }
  next();
};

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    // user checking and updateing
    app.post("/users", async (req, res) => {
      const email = req.body.email;
      const userExists = await userCollection.findOne({ email });
      if (userExists) {
        return res
          .status(200)
          .send({ message: "user already exist ", inserted: false });
      }
      const user = req.body;
      const result = await userCollection.insertOne(user);
      res.send(result);
    });
    /* Send parcle  */
    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      try {
        const result = await parcelCollection.insertOne(parcel);
        if (result.insertedId) {
          return res.status(201).json({
            message: "Parcel added successfully",
            insertedId: result.insertedId,
            parcel: parcel,
          });
        } else {
          return res.status(500).json({ error: "Insert failed" });
        }
      } catch (error) {
        console.error("Error inserting parcel:", error);
        return res.status(500).json({ error: "Server error" });
      }
    });

    app.get("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        // Ensure the ID is a valid MongoDB ObjectId
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid Parcel ID" });
        }

        const parcel = await parcelCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!parcel) {
          return res.status(404).json({ message: "Parcel not found" });
        }

        res.send(parcel);
      } catch (error) {
        console.error("Error getting parcel by ID:", error);
        res.status(500).json({ message: "Failed to get parcel" });
      }
    });

    app.get("/parcels", async (req, res) => {
      try {
        const email = req.query.email;
        const query = email ? { email: email } : {};
        const parcels = await parcelCollection
          .find(query)
          .sort({ creation_date: -1 }) /* get latest product  */
          .toArray();
        res.send(parcels);
      } catch (error) {
        console.log(error);
      }
    });
    /* Check the rider is available on your reliogn (assign rider btn hitting) */
    app.get("/riders/available", async (req, res) => {
      const { district } = req.query;
      try {
        const riders = await riderCollection
          .find({
            district,
            // status: { $in: ["approved", "active"] },
            // work_status: "available",
          })
          .toArray();

        res.send(riders);
      } catch (err) {
        res.status(500).send({ message: "Failed to load riders" });
      }
    });

    /* Update rider status and other  */
    app.patch("/parcels/:id/assign", async (req, res) => {
      const parcelId = req.params.id;
      const { riderId, riderName, riderEmail } = req.body;
      try {
        // Update parcel
        await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          {
            $set: {
              delivery_status: "rider_assigned",
              assigned_rider_id: riderId,
              assigned_rider_email: riderEmail,
              assigned_rider_name: riderName,
            },
          }
        );
        // Update rider
        await riderCollection.updateOne(
          { _id: new ObjectId(riderId) },
          {
            $set: {
              work_status: "in_delivery",
            },
          }
        );
        res.send({ message: "Rider assigned" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to assign rider" });
      }
    });

    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const result = await parcelCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send(result);
      } catch (error) {
        console.error("Error deleting parcel:", error);
        res.status(500).send({ error: "Failed to delete parcel" });
      }
    });

    app.post("/create-payment-intent", async (req, res) => {
      const amountInCents = req.body.amountInCents;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          // amount: 1000, // amount in cents
          amount: amountInCents,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    /* Be a rider req  */
    app.post("/riders", async (req, res) => {
      const rider = req.body;
      const result = await riderCollection.insertOne(rider);
      res.send(result);
    });
    /* pending rider req get  */
    app.get("/riders/pending", async (req, res) => {
      try {
        const pendingRiders = await riderCollection
          .find({ status: "pending" })
          .toArray();
        res.send(pendingRiders);
      } catch (error) {
        console.error("Error loading pending riders:", error);
        res.status(500).send({ error: "Failed to fetch pending riders" });
      }
    });
    /* rider status and role update  */
    app.patch("/riders/:id/status", async (req, res) => {
      const { id } = req.params;
      const { status, email } = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          status,
        },
      };

      try {
        const result = await riderCollection.updateOne(query, updateDoc);

        // update user role for accepting rider
        if (status === "active") {
          const userQuery = { email };
          const userUpdateDoc = {
            $set: {
              role: "rider",
            },
          };
          const roleResult = await userCollection.updateOne(
            userQuery,
            userUpdateDoc
          );
          console.log(roleResult.modifiedCount);
        }

        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to update rider status" });
      }
    });
    /* checking by user email that he is admin or not  */
    app.get("/users/:email/role", async (req, res) => {
      try {
        const email = req.params.email;

        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }

        const user = await userCollection.findOne({ email });

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send({ role: user.role || "user" });
      } catch (error) {
        console.error("Error getting user role:", error);
        res.status(500).send({ message: "Failed to get role" });
      }
    });

    /* Update a user and make admin */

    app.patch(
      "/users/:id/role",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { role } = req.body;

        if (!["admin", "user"].includes(role)) {
          return res.status(400).send({ message: "Invalid role" });
        }

        try {
          const result = await userCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { role } }
          );

          res.send({
            message: `User role updated to ${role}`,
            result,
          });
        } catch (error) {
          console.error("Error updating role:", error);
          res.status(500).send({ error: "Failed to update role" });
        }
      }
    );

    /* delete from ui  (rider request )*/
    app.patch("/riders/reject/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = { $set: { status: "rejected" } };
      const result = await riderCollection.updateOne(filter, updateDoc);
      res.send(result);
    });
    /* active rider component */
    app.get("/riders/active", verifyFBToken, verifyAdmin, async (req, res) => {
      const riders = await riderCollection.find({ status: "active" }).toArray();
      res.send(riders);
    });
    /* Deactive rider  */
    app.patch("/riders/deactivate/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = { $set: { status: "deactivated" } };
      const result = await riderCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    /* search specific user by api  */
    app.get("/users/search", async (req, res) => {
      const email = req.query.email;

      try {
        const users = await userCollection
          .find({ email: { $regex: new RegExp(email, "i") } })
          .project({ email: 1, role: 1 }) // ✅ select only email, role
          .limit(10)
          .toArray();

        if (users.length === 0) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send(users);
      } catch (err) {
        console.error("User search failed:", err);
        res.status(500).send({ error: "Internal Server Error" });
      }
    });

    /* after walet payment  */
    app.post("/payments", async (req, res) => {
      try {
        const { parcelId, email, amount, transactionId, paymentMethod } =
          req.body;

        const paymentDoc = {
          parcelId,
          email,
          amount,
          transactionId,
          paymentMethod,
          paid_at_string: new Date(),
          paid_at: new Date(),
        };
        const paymentResult = await paymentCollection.insertOne(paymentDoc);

        const res2 = await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          { $set: { paymentStatus: "paid" } }
        );
        console.log(res2);
        res.send({
          success: true,
          message: "Payment saved and parcel marked as paid",
          insertedId: paymentResult.insertedId,
        });
      } catch (error) {
        console.error("Payment insert error:", error);
        res.status(500).send({ success: false, error: error.message });
      }
    });
    app.get("/payments", async (req, res) => {
      try {
        const userEmail = req.query.email;
        const query = userEmail ? { email: userEmail } : {};

        const payments = await db
          .collection("payments")
          .find(query)
          .sort({ date: -1 }) // DESCENDING: latest first
          .toArray();

        res.send(payments);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: error.message });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// Default route
app.get("/", (req, res) => {
  res.send("delivery Server is running!");
});

// Start server
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
