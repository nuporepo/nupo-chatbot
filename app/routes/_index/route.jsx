import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Nupo Chatbot - Your AI Waiter</h1>
        <p className={styles.text}>
          Transform your online store with an AI shopping assistant that works like a professional waiter - helping customers browse, recommend products, manage carts, and handle everything except payment.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Waiter-Style Service</strong>. Just like in a restaurant, customers never have to leave their seat. Our AI handles product browsing, recommendations, cart management, and order preparation.
          </li>
          <li>
            <strong>Smart Product Discovery</strong>. Advanced AI that learns from your entire store catalog and customer interactions to provide personalized recommendations and answer product questions.
          </li>
          <li>
            <strong>Complete Order Management</strong>. Handles everything from cart creation to shipping calculations and discount applications - customers only need to complete payment at the end.
          </li>
          <li>
            <strong>Self-Training Intelligence</strong>. Automatically learns from successful conversations and customer behavior to continuously improve recommendations and responses.
          </li>
          <li>
            <strong>Seamless Integration</strong>. Embeds directly into your store as an iframe - no popups or redirects. Supports both hero sections and floating chat widgets.
          </li>
          <li>
            <strong>Multi-Language Support</strong>. Automatically detects your store's language and communicates with customers in their preferred language.
          </li>
        </ul>
      </div>
    </div>
  );
}
