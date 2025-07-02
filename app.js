require('dotenv').config(); // Load environment variables from .env

const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js'); // Supabase client
const session = require('express-session'); // Session management

const app = express();
const PORT = process.env.PORT || 3000;

// --- Supabase Client Setup ---
const supabaseUrl = process.env.SUPABASE_URL;
// For server-side authentication, you can use the service_role key.
// For client-side auth, you'd use the public anon key.
const supabaseServiceKey = process.env.SUPABASE_API_KEY;
// The public anon key is generally used for client-side auth calls.
// Since our server handles all auth interactions, we'll use the service key
// for simplicity in this server-rendered example to bypass RLS easily.
// If you implement RLS and want to test it via server routes, you'd
// consider using the anon key for auth.signUp/signIn and the service key
// for other admin actions or when user session is established.
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY; // You might want to add this to your .env and use for auth calls.
// For this example, we'll initialize two clients:
// one with service role for database ops, one with anon for client-facing auth calls
const supabaseService = createClient(supabaseUrl, supabaseServiceKey);
const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey || supabaseServiceKey); // Fallback to service key if anon not set

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('ERROR: Supabase URL and Service Role Key must be provided in .env');
    process.exit(1);
}

// Verify Supabase connection (optional, for debugging)
async function testSupabaseConnection() {
    try {
        const { data, error } = await supabaseService.from('posts').select('id').limit(1);
        if (error) throw error;
        console.log('Successfully connected to Supabase.');
    } catch (err) {
        console.error('Error connecting to Supabase: ' + err.message);
        console.error('Please check your Supabase URL and Service Role Key in .env.');
        process.exit(1);
    }
}
testSupabaseConnection();


// --- Middleware ---
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from 'public'
app.use(expressLayouts); // Use express-ejs-layouts for layout support
app.set('view engine', 'ejs'); // Set EJS as the view engine
app.set('layout', './layouts/main'); // Set default layout for all views

// Body parser middleware to handle form data
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET, // Should be a long, random string
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // Use secure cookies in production (requires HTTPS)
        maxAge: 1000 * 60 * 60 * 24 // 24 hours
    }
}));

// Middleware to pass user session data to all views
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.message = req.session.message || null; // For flash messages
    delete req.session.message; // Clear message after displaying
    next();
});

// --- Custom Authentication Middleware ---
function isAuthenticated(req, res, next) {
    if (req.session.user) {
        return next();
    }
    req.session.message = 'Please log in to access this page.';
    res.redirect('/login');
}

function redirectIfAuthenticated(req, res, next) {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    next();
}


// --- Routes ---

// Home/All Posts Page
app.get('/', async (req, res) => {
    try {
        const { data: posts, error } = await supabaseService // Use service client for data fetching
            .from('posts')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.render('posts/index', { posts: posts, title: 'All Blog Posts' });
    } catch (err) {
        console.error('Error fetching posts from Supabase: ' + err.message);
        req.session.message = 'Error fetching posts.';
        res.render('error', { message: req.session.message });
    }
});

// --- Authentication Routes ---

// Register - GET (Show form)
app.get('/register', redirectIfAuthenticated, (req, res) => {
    res.render('auth/register', { title: 'Register' });
});

// Register - POST (Handle form submission)
app.post('/register', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        req.session.message = 'Email and password are required.';
        return res.redirect('/register');
    }

    try {
        // Use supabaseAnon for auth calls, as it handles RLS and typical user flows.
        const { data, error } = await supabaseAnon.auth.signUp({
            email: email,
            password: password
        });

        if (error) {
            req.session.message = 'Registration failed: ' + error.message;
            return res.redirect('/register');
        }

        // Supabase sends a confirmation email by default if enabled in project settings.
        // If email confirmation is required, the user won't be signed in automatically.
        // For simplicity, this example assumes email confirmation is OFF for testing,
        // or that you handle the post-confirmation flow (e.g., redirect to dashboard after verification).
        if (data.user) {
            req.session.user = { id: data.user.id, email: data.user.email };
            req.session.message = 'Registration successful! You are now logged in.';
            res.redirect('/dashboard');
        } else {
             // This case happens if email confirmation is required but not yet done
             req.session.message = 'Registration successful! Please check your email to confirm your account.';
             res.redirect('/login'); // Redirect to login, user needs to confirm first
        }


    } catch (err) {
        console.error('Registration error: ' + err.message);
        req.session.message = 'An unexpected error occurred during registration.';
        res.redirect('/register');
    }
});

// Login - GET (Show form)
app.get('/login', redirectIfAuthenticated, (req, res) => {
    res.render('auth/login', { title: 'Login' });
});

// Login - POST (Handle form submission)
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        req.session.message = 'Email and password are required.';
        return res.redirect('/login');
    }

    try {
        const { data, error } = await supabaseAnon.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            req.session.message = 'Login failed: ' + error.message;
            return res.redirect('/login');
        }

        req.session.user = { id: data.user.id, email: data.user.email };
        req.session.message = 'Logged in successfully!';
        res.redirect('/dashboard');
    } catch (err) {
        console.error('Login error: ' + err.message);
        req.session.message = 'An unexpected error occurred during login.';
        res.redirect('/login');
    }
});

// Logout
app.get('/logout', async (req, res) => {
    try {
        const { error } = await supabaseAnon.auth.signOut();
        if (error) throw error;
        req.session.destroy(err => {
            if (err) {
                console.error('Error destroying session:', err);
                req.session.message = 'Error logging out.';
                return res.redirect('/dashboard'); // Or home, depending on preferred error redirect
            }
            res.clearCookie('connect.sid'); // Clear session cookie
            req.session.message = 'You have been logged out.';
            res.redirect('/');
        });
    } catch (err) {
        console.error('Supabase logout error: ' + err.message);
        req.session.message = 'Error logging out from Supabase.';
        res.redirect('/dashboard');
    }
});

// --- Protected Routes ---

// Dashboard (Example protected page)
app.get('/dashboard', isAuthenticated, (req, res) => {
    res.render('profile/dashboard', { title: 'Dashboard', user: req.session.user });
});


// Show Form to Create New Post (Protected)
app.get('/posts/new', isAuthenticated, (req, res) => {
    res.render('posts/new', { title: 'Create New Post' });
});

// Handle New Post Submission (Protected)
app.post('/posts', isAuthenticated, async (req, res) => {
    const { title, content, author } = req.body; // Author can be overridden by user if provided, otherwise logged-in user's email
    const postAuthor = author || req.session.user.email || 'Anonymous'; // Default to user email if logged in

    if (!title || !content) {
        req.session.message = 'Title and Content are required.';
        return res.status(400).render('error', { message: req.session.message });
    }

    try {
        const { data, error } = await supabaseService // Use service client for database write
            .from('posts')
            .insert([
                {
                    title: title,
                    content: content,
                    author: postAuthor
                }
            ])
            .select();

        if (error) throw error;
        console.log(`New post created.`);
        req.session.message = 'Post created successfully!';
        res.redirect('/');
    } catch (err) {
        console.error('Error inserting new post into Supabase: ' + err.message);
        req.session.message = 'Error creating post.';
        res.render('error', { message: req.session.message });
    }
});

// Show Single Post (Remains public)
app.get('/posts/:id', async (req, res) => {
    const postId = req.params.id;
    try {
        const { data: posts, error } = await supabaseService // Use service client for data read
            .from('posts')
            .select('*')
            .eq('id', postId)
            .limit(1);

        if (error) throw error;

        if (!posts || posts.length === 0) {
            req.session.message = 'Post not found.';
            return res.status(404).render('error', { message: req.session.message });
        }
        res.render('posts/show', { post: posts[0], title: posts[0].title });
    } catch (err) {
        console.error('Error fetching single post from Supabase: ' + err.message);
        req.session.message = 'Error fetching post.';
        res.render('error', { message: req.session.message });
    }
});


// 404 Page (Catch-all)
app.use((req, res) => {
    res.status(404).render('error', { message: 'Page Not Found', title: '404' });
});


// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});