import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

/*
  GANTI data di bawah dengan Firebase Config milik Anda:
  Firebase Console > Project settings > Your apps > Web app > SDK setup and configuration.
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBcYsqJz7_HhcGdApR-a0yoNIZhlJhpekc",
  authDomain: "pembayaran-15212.firebaseapp.com",
  projectId: "pembayaran-15212",
  storageBucket: "pembayaran-15212.firebasestorage.app",
  messagingSenderId: "1072413200722",
  appId: "1:1072413200722:web:75fb353a9adbdb1ef7ea8b",
  measurementId: "G-4QZJK45ZXH"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
