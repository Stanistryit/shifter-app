import pandas as pd
import re
import os
import glob
import time
import sys

def get_file_path():
    print("\n--- 📂 КРОК 1: ВИБІР ФАЙЛУ ---")
    
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir) 
    
    extensions = ['*.xlsx', '*.csv']
    local_files = []
    for ext in extensions:
        local_files.extend(glob.glob(ext))
    
    local_files = [f for f in local_files 
                   if not os.path.basename(f).startswith('~$') 
                   and not f.startswith('shifter_import')]
    
    if local_files:
        print(f"Пошук у: {script_dir}")
        for i, f in enumerate(local_files):
            print(f"   [{i+1}] {f}")
        print(f"   [{len(local_files)+1}] ✍️  Вказати шлях вручну")
    else:
        print(f"❌ У папці {script_dir} файлів не знайдено.")
        print(f"   [{1}] ✍️  Вказати шлях вручну")
        local_files = [] 
    
    while True:
        choice = input("\n👉 Твій вибір: ").strip()
        if choice.isdigit():
            choice_idx = int(choice) - 1
            if 0 <= choice_idx < len(local_files):
                return os.path.abspath(local_files[choice_idx])
            elif choice_idx == len(local_files) or (not local_files and choice_idx == 0):
                manual_path = input("Встав шлях: ").strip().strip('"').strip("'")
                if os.path.exists(manual_path): return manual_path
                else: print("❌ Файл не знайдено.")
            else:
                print("❌ Невірний номер.")
        else:
            clean_path = choice.strip('"').strip("'")
            if os.path.exists(clean_path): return clean_path
            else: print(f"❌ Файл не знайдено.")

def select_name_column(df):
    print("\n--- 🕵️ КРОК 3: ДЕ КОЛОНКА З ІМЕНАМИ? ---")
    columns = list(df.columns)
    preview_cols = columns[:10] 
    suggested_index = -1
    
    for i, col in enumerate(preview_cols):
        marker = ""
        if any(x in str(col).lower() for x in ['піп', 'name', 'співробітник', 'ім\'я']):
            marker = "  <-- (Схоже на це)"
            if suggested_index == -1: suggested_index = i
        print(f"   [{i+1}] {col}{marker}")

    while True:
        user_input = input(f"\nВведи номер колонки (Enter = {suggested_index + 1}): ").strip()
        if user_input == "" and suggested_index != -1: return columns[suggested_index]
        if user_input.isdigit():
            idx = int(user_input) - 1
            if 0 <= idx < len(columns): return columns[idx]
            else: print("❌ Невірний номер.")
        else: print("❌ Введи цифру.")

def process_file(filename):
    print(f"\n--- 🔄 КРОК 2: ЧИТАННЯ ФАЙЛУ ---")
    try:
        if filename.lower().endswith('.csv'):
            try: df = pd.read_csv(filename, sep=None, engine='python', encoding='utf-8')
            except: df = pd.read_csv(filename, sep=None, engine='python', encoding='cp1251')
        else:
            xls_file = pd.ExcelFile(filename)
            sheet_names = xls_file.sheet_names
            valid_sheets = [s for s in sheet_names if not any(x in str(s).lower() for x in ["відпуст", "info", "довідка"])]
            
            if len(valid_sheets) > 1:
                print(f"\nЗнайдено сторінки: {valid_sheets}")
                print("Натисни [Enter], щоб обробити ВСІ, або введи назву:")
                user_choice = input("👉 Вибір: ").strip()
                if user_choice and user_choice in sheet_names: valid_sheets = [user_choice]
            
            all_dataframes = []
            for sheet in valid_sheets:
                print(f"   📄 Читаю: {sheet}")
                d = pd.read_excel(xls_file, sheet_name=sheet)
                all_dataframes.append(d)
            if not all_dataframes: return []
            df = pd.concat(all_dataframes, ignore_index=True)
    except Exception as e:
        print(f"❌ ПОМИЛКА: {e}")
        return []

    df.columns = df.columns.astype(str).str.strip()
    name_col = select_name_column(df)
    
    # Шукаємо дати
    date_cols = [c for c in df.columns if re.search(r'202\d-\d{2}-\d{2}', c)]
    time_pattern = re.compile(r'(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})')
    
    print(f"✅ Колонка імен: '{name_col}'")
    print(f"✅ Колонок з датами: {len(date_cols)}")

    extracted_shifts = []
    
    # --- НОВА ЛОГІКА "РОЗУМНОГО" ПОШУКУ ---
    current_person_name = None # Тут будемо тримати ім'я "зверху"

    print("\n🔍 Сканую рядки...")
    
    for index, row in df.iterrows():
        cell_value = row[name_col]
        
        # Перевіряємо, чи є в колонці "ПІП" щось схоже на ім'я
        if pd.notna(cell_value) and str(cell_value).strip() != '':
            val_str = str(cell_value).strip()
            
            # Якщо це схоже на посаду (SM 9, SSE 6), то це РЯДОК З ГРАФІКОМ
            # І ім'я ми беремо з попереднього кроку (current_person_name)
            is_position_code = re.match(r'^(SM|SSE|SE|Staff)\s*\d+', val_str, re.IGNORECASE)
            
            if is_position_code:
                # Це рядок з годинами! Чи знаємо ми чий він?
                if current_person_name:
                    # Проходимо по датах для ЦЬОГО рядка
                    for date_col in date_cols:
                        time_val = str(row[date_col])
                        
                        # --- ТУТ МИ ШУКАЄМО ЗМІНИ ---
                        match = time_pattern.search(time_val)
                        
                        if match:
                            # Якщо знайдено час (10:00-20:00)
                            start, end = match.group(1), match.group(2)
                            clean_date = re.search(r'202\d-\d{2}-\d{2}', date_col).group(0)
                            extracted_shifts.append(f"{clean_date}, {current_person_name}, {start}, {end}")
                        else:
                            # --- ДОДАНО: ПЕРЕВІРКА НА ВІДПУСТКУ ---
                            val_lower = time_val.lower()
                            if 'відпуст' in val_lower or 'vacation' in val_lower or val_lower.strip() in ['в', 'v']:
                                clean_date = re.search(r'202\d-\d{2}-\d{2}', date_col).group(0)
                                # Формат для сайту: Дата, Ім'я, Відпустка (3 параметри)
                                extracted_shifts.append(f"{clean_date}, {current_person_name}, Відпустка")
                            # ---------------------------------------

                else:
                    # Знайшли графік, але не знаємо чий він (не було імені зверху)
                    pass
            
            else:
                # Це НЕ схоже на посаду (SM 9), значить це, ймовірно, ІМ'Я ЛЮДИНИ
                # Запам'ятовуємо його на майбутнє
                # Ігноруємо слова типу "Грейд", "ПІП"
                if val_str.lower() not in ['грейд', 'піп', 'посада']:
                    current_person_name = val_str
                    # print(f"   👤 Знайдено співробітника: {current_person_name}")

    return extracted_shifts

def main():
    filepath = get_file_path()
    if not filepath: return

    shifts = process_file(filepath)

    if shifts:
        print(f"\n--- 🎉 РЕЗУЛЬТАТ ({len(shifts)} змін) ---")
        desktop = os.path.join(os.path.expanduser("~"), "Desktop")
        timestamp = time.strftime("%H-%M-%S")
        output_file = os.path.join(desktop, f"shifter_import_{timestamp}.txt")
        
        saved = False
        try:
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write('\n'.join(shifts))
            print(f"💾 Файл збережено на Робочому столі: {output_file}")
            saved = True
        except:
            try:
                output_file = f"shifter_import_{timestamp}.txt"
                with open(output_file, 'w', encoding='utf-8') as f:
                    f.write('\n'.join(shifts))
                print(f"💾 Файл збережено в папці скрипта: {output_file}")
                saved = True
            except: pass

        if not saved:
            print("\n❌ Помилка запису. Скопіюй текст:")
            print("="*40)
            print('\n'.join(shifts))
            print("="*40)
    else:
        print("\n😞 Змін не знайдено. Перевір, чи є рядок з ім'ям НАД рядком з кодом (SM 9).")

if __name__ == "__main__":
    try: main()
    except KeyboardInterrupt: pass
    input("\nНатисни Enter, щоб вийти...")