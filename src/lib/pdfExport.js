/**
 * PDF Export Utilities
 * Generates downloadable PDFs for shopping lists and nutrition plans.
 */
import jsPDF from "jspdf";
import { formatCurrency } from "@/lib/calculations";

export function generateShoppingListPDF(list, profile) {
  const doc = new jsPDF();
  const margin = 20;
  let y = margin;

  // Title
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text("BetterCart — Shopping List", margin, y);
  y += 10;

  // Subtitle
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, margin, y);
  y += 5;
  if (list.shopping_period_days) {
    doc.text(`Shopping period: ${list.shopping_period_days} days`, margin, y);
    y += 5;
  }
  doc.text(`Total estimated cost: ${formatCurrency(list.total_estimated_cost)}`, margin, y);
  y += 5;
  doc.text(`Total calories: ${list.total_calories?.toLocaleString() || "N/A"}`, margin, y);
  y += 12;

  // Table Header
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  const cols = [margin, 70, 95, 115, 140, 160];
  doc.text("Product", cols[0], y);
  doc.text("Category", cols[1], y);
  doc.text("Qty", cols[2], y);
  doc.text("Price", cols[3], y);
  doc.text("Calories", cols[4], y);
  doc.text("P/C/F", cols[5], y);
  y += 2;
  doc.line(margin, y, 195, y);
  y += 5;

  // Table Rows
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  list.items?.forEach(item => {
    if (y > 270) {
      doc.addPage();
      y = margin;
    }
    doc.text(item.name?.slice(0, 25) || "", cols[0], y);
    doc.text(item.category || "", cols[1], y);
    doc.text(item.quantity || "", cols[2], y);
    doc.text(formatCurrency(item.estimated_price), cols[3], y);
    doc.text(String(item.calories || ""), cols[4], y);
    doc.text(`${item.protein}/${item.carbs}/${item.fat}g`, cols[5], y);
    y += 6;
  });

  // Footer
  y += 5;
  doc.line(margin, y, 195, y);
  y += 8;
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(`Total: ${formatCurrency(list.total_estimated_cost)}`, margin, y);

  doc.save("BetterCart_Shopping_List.pdf");
}

export function generateNutritionPlanPDF(plan, profile) {
  const doc = new jsPDF();
  const margin = 20;
  let y = margin;

  // Title
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text("BetterCart — Nutrition Plan", margin, y);
  y += 10;

  // Info
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Goal: ${profile?.goal || "N/A"}`, margin, y);
  y += 5;
  doc.text(`Daily calories: ${plan.daily_calories}`, margin, y);
  y += 5;
  doc.text(`Weekly cost: ${formatCurrency(plan.estimated_weekly_cost)}`, margin, y);
  y += 10;

  // Days
  plan.days?.forEach(day => {
    if (y > 250) {
      doc.addPage();
      y = margin;
    }

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(day.day_name, margin, y);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`${day.total_calories} cal | P:${day.total_protein}g C:${day.total_carbs}g F:${day.total_fat}g | ${formatCurrency(day.estimated_cost)}`, 60, y);
    y += 7;

    day.meals?.forEach(meal => {
      if (y > 265) {
        doc.addPage();
        y = margin;
      }

      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text(`  ${meal.meal_type} (${meal.total_calories} cal)`, margin, y);
      y += 5;

      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      meal.items?.forEach(item => {
        if (y > 275) {
          doc.addPage();
          y = margin;
        }
        doc.text(`    ${item.food_name} — ${item.grams}g — ${item.calories} cal (P:${item.protein} C:${item.carbs} F:${item.fat})`, margin, y);
        y += 4.5;
      });
      y += 2;
    });
    y += 5;
  });

  doc.save("BetterCart_Nutrition_Plan.pdf");
}