import pandas as pd
import re
import os
import glob
import time
import sys
import warnings

warnings.simplefilter("ignore")

def get_file_path():
    print("\n--- 📂 КРОК 1: ВИБІР ФАЙЛУ ---")
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir) 
    
    extensions = ['*.xlsx', '*.csv']
    local_files = []
    for ext in extensions: local_files.extend(glob.glob(ext))
    
    local_files = [f for f in local_files if not os.path.basename(f).startswith('~$') and not f.startswith('shifter_import')]
    
    if local_files:
        print(f"Пошук у: {script_dir}")
        for i, f in enumerate(local_files): print(f"   [{i+1}] {f}")
        print(f"   [{len(local_files)+1}] ✍️  Вказати шлях вручну")
    else:
        print(f"❌ Файлів не знайдено.")
        local_files = [] 
    
    while True:
        choice = input("\n👉 Твій вибір: ").strip()
        if choice.isdigit():
            idx = int(choice) - 1
            if 0 <= idx < len(local_files): return os.path.abspath(local_files[idx])
            elif idx == len(local_files): 
                p = input("Встав шлях: ").strip().strip('"').strip("'")
                if os.path.exists(p): return p
        else:
            p = choice.strip('"').strip("'")
            if os.path.exists(p): return p
        print("❌ Невірний ввід.")

def select_name_column(df):
    print("\n--- 🕵️ КРОК 3: ДЕ КОЛОНКА З ІМЕНАМИ? ---")
    cols = list(df.columns)
    s_idx = -1
    for i, c in enumerate(cols[:10]):
        m = "  <-- (Схоже на це)" if any(x in str(c).lower() for x in ['піп','name','співробітник','ім\'я']) else ""
        if m and s_idx == -1: s_idx = i
        print(f"   [{i+1}] {c}{m}")

    while True:
        inp = input(f"\nНомер колонки (Enter = {s_idx + 1}): ").strip()
        if inp == "" and s_idx != -1: return cols[s_idx]
        if inp.isdigit():
            idx = int(inp) - 1
            if 0 <= idx < len(cols): return cols[idx]
        print("❌ Невірний номер.")

def process_file(filename):
    print(f"\n--- 🔄 КРОК 2: ЧИТАННЯ ФАЙЛУ ---")
    try:
        if filename.lower().endswith('.csv'):
            try: df = pd.read_csv(filename, sep=None, engine='python', encoding='utf-8')
            except: df = pd.read_csv(filename, sep=None, engine='python', encoding='cp1251')
        else:
            xls = pd.ExcelFile(filename)
            sheets = [s for s in xls.sheet_names if not any(x in str(s).lower() for x in ["відпуст", "info", "довідка", "службовий"])]
            if len(sheets) > 1:
                print(f"Знайдено сторінки: {sheets}")
                print("Натисни Enter (обробити ВСІ) або введи назву:")
                uc = input("👉 Вибір: ").strip()
                if uc and uc in sheets: sheets = [uc]
            
            dfs = []
            for s in sheets:
                print(f"   📄 Читаю: {s}")
                dfs.append(pd.read_excel(xls, sheet_name=s))
            if not dfs: return []
            df = pd.concat(dfs, ignore_index=True)
    except Exception as e: print(f"❌ ПОМИЛКА: {e}"); return []

    df.columns = df.columns.astype(str).str.strip()
    name_col = select_name_column(df)
    date_cols = [c for c in df.columns if re.search(r'202\d-\d{2}-\d{2}', c)]
    time_pat = re.compile(r'(\d{1,2}[:.]\d{2})\s*-\s*(\d{1,2}[:.]\d{2})')
    
    print(f"✅ Колонка імен: '{name_col}' | Дат: {len(date_cols)}")
    shifts = []
    cur_name = None 

    print("\n🔍 Сканую рядки...")
    for i, row in df.iterrows():
        val = row[name_col]
        if pd.notna(val) and str(val).strip():
            s_val = str(val).strip()
            # Якщо це код посади (SM 9...)
            if re.match(r'^(SM|SSE|SE|Staff)\s*\d+', s_val, re.IGNORECASE):
                if cur_name:
                    for d_col in date_cols:
                        t_val = str(row[d_col]).strip()
                        match = time_pat.search(t_val)
                        c_date = re.search(r'202\d-\d{2}-\d{2}', d_col).group(0)

                        if match:
                            s, e = match.group(1).replace('.', ':'), match.group(2).replace('.', ':')
                            # ТУТ ТЕПЕР ПРОБІЛИ В ІМЕНІ
                            shifts.append(f"{c_date} {cur_name} {s} {e}")
                        else:
                            v_low = t_val.lower()
                            if 'відпуст' in v_low or 'vacation' in v_low or v_low in ['в', 'v']:
                                shifts.append(f"{c_date} {cur_name} Відпустка")
            else:
                # Це ім'я
                if s_val.lower() not in ['грейд', 'піп', 'посада', 'total', 'всього']:
                    cur_name = s_val

    return shifts

def main():
    path = get_file_path()
    if not path: return
    shifts = process_file(path)

    if shifts:
        print(f"\n--- 🎉 РЕЗУЛЬТАТ ({len(shifts)} записів) ---")
        desk = os.path.join(os.path.expanduser("~"), "Desktop")
        f_name = f"shifter_import_{time.strftime('%H-%M-%S')}.txt"
        out = os.path.join(desk, f_name)
        
        try:
            with open(out, 'w', encoding='utf-8') as f: f.write('\n'.join(shifts))
            print(f"💾 Збережено на Робочий стіл: {f_name}")
        except:
            with open(f_name, 'w', encoding='utf-8') as f: f.write('\n'.join(shifts))
            print(f"💾 Збережено в папці скрипта: {f_name}")
            
        print("\n👉 Тепер онови JS-код на сайті (функцію bulkImport), щоб він розумів імена з пробілами!")
    else:
        print("\n😞 Даних не знайдено.")

if __name__ == "__main__":
    try: main()
    except KeyboardInterrupt: pass
    input("\nEnter для виходу...")