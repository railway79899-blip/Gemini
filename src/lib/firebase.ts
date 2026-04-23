import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDocs, updateDoc, deleteDoc, query, orderBy, serverTimestamp, getDocFromServer, where } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { ChatMessage } from './gemini';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export const googleProvider = new GoogleAuthProvider();

export async function loginWithGoogle() {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    console.error('Login failed', error);
  }
}

export async function logout() {
  await signOut(auth);
}

// Ensure the connection is valid on boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export async function saveChatSession(userId: string, chatSession: ChatSession) {
  const chatRef = doc(db, 'users', userId, 'chats', chatSession.id);
  
  const payload = {
    title: chatSession.title,
    userId: userId,
    messagesJson: JSON.stringify(chatSession.messages),
    updatedAt: serverTimestamp()
  };

  try {
    // Check if exists
    const existing = await getDocFromServer(chatRef);
    if (existing.exists()) {
      await updateDoc(chatRef, payload);
    } else {
      await setDoc(chatRef, {
        ...payload,
        createdAt: serverTimestamp()
      });
    }
  } catch (error) {
    console.error("Failed to save chat:", error);
    throw error;
  }
}

export async function getUserChats(userId: string): Promise<ChatSession[]> {
  const chatsRef = collection(db, 'users', userId, 'chats');
  const q = query(chatsRef, where('userId', '==', userId), orderBy('updatedAt', 'desc'));
  
  try {
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title,
        messages: JSON.parse(data.messagesJson || '[]'),
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date()
      };
    });
  } catch (error) {
    console.error("Failed to fetch chats:", error);
    return [];
  }
}

export async function deleteChatSession(userId: string, chatId: string) {
  const chatRef = doc(db, 'users', userId, 'chats', chatId);
  try {
    await deleteDoc(chatRef);
  } catch (error) {
    console.error("Failed to delete chat:", error);
    throw error;
  }
}
