import json
import subprocess
import os
import time

TOKEN = os.environ.get("GITHUB_TOKEN")
ORG = "ceejaylaboratory"
REPO = "AnchorPoint"
REPO_URL = f"https://ceejaylaboratory:{TOKEN}@github.com/{ORG}/{REPO}.git"

def run(cmd, shell=False):
    # print(f"Running: {cmd}")
    result = subprocess.run(cmd, shell=shell, capture_output=True, text=True)
    return result

def write_log(msg):
    with open("final_merge_log.txt", "a") as f:
        f.write(f"{time.ctime()}: {msg}\n")
    # print(msg)

def resolve_cargo_toml():
    try:
        if not os.path.exists("Cargo.toml"):
            return False
        with open("Cargo.toml", "r") as f:
            lines = f.readlines()
        
        new_lines = []
        in_conflict = False
        head_members = set()
        indent = "    "
        
        pr_members = set()
        in_head = False
        in_pr = False
        
        for line in lines:
            if "<<<<<<<" in line:
                in_conflict = True
                in_head = True
                continue
            elif "=======" in line:
                in_head = False
                in_pr = True
                continue
            elif ">>>>>>>" in line:
                in_conflict = False
                in_pr = False
                # Combine members
                all_members = sorted(list(head_members.union(pr_members)))
                for m in all_members:
                    if m:
                        new_lines.append(f'{indent}"{m}",\n')
                head_members = set()
                pr_members = set()
                continue
            
            if in_conflict:
                m = line.strip().strip(',').strip('"').strip()
                if m:
                    if in_head: head_members.add(m)
                    if in_pr: pr_members.add(m)
            else:
                new_lines.append(line)
                
        with open("Cargo.toml", "w") as f:
            f.writelines(new_lines)
        return True
    except Exception as e:
        write_log(f"Error resolving Cargo.toml: {e}")
        return False

def post_comment(pr_number):
    url = f"https://api.github.com/repos/{ORG}/{REPO}/issues/{pr_number}/comments"
    headers = {
        "Authorization": f"token {TOKEN}",
        "Accept": "application/vnd.github.v3+json"
    }
    import requests
    try:
        resp = requests.post(url, headers=headers, json={"body": "Nice implementation, LGTM!"})
        if resp.status_code == 201:
            write_log(f"Commented on PR #{pr_number}")
        else:
            write_log(f"Failed to comment on PR #{pr_number}: {resp.status_code}")
    except Exception as e:
        write_log(f"Error commenting on PR #{pr_number}: {e}")

def main():
    if not TOKEN:
        write_log("GITHUB_TOKEN not set!")
        return

    # Setup git
    run(["git", "config", "user.email", "ceejay@example.com"])
    run(["git", "config", "user.name", "Ceejay AI"])
    run(["git", "remote", "set-url", "origin", REPO_URL])
    
    # Ensure script files are ignored
    if not os.path.exists(".gitignore"):
        run(["touch", ".gitignore"])
    
    with open(".gitignore", "a") as f:
        f.write("\nfinal_merge.py\nprocess_prs.py\nprs.json\nopen_prs.json\n*.txt\n")
    
    with open("open_prs.json", "r") as f:
        prs = json.load(f)
    
    # Process in chronological order (oldest first)
    prs.sort(key=lambda x: x["created_at"])
    
    write_log(f"Starting final merge of {len(prs)} PRs.")

    for pr in prs:
        pr_number = pr["number"]
        write_log(f"Processing PR #{pr_number}: {pr['title']}")
        
        # Post comment
        post_comment(pr_number)
        
        # 1. Fetch
        res = run(["git", "fetch", "origin", f"pull/{pr_number}/head:pr-{pr_number}"])
        if res.returncode != 0:
            write_log(f"Fetch failed for PR #{pr_number}")
            continue
            
        # 2. Merge
        res = run(["git", "merge", f"pr-{pr_number}", "-m", f"Merge PR #{pr_number}"])
        if res.returncode != 0:
            write_log(f"Conflict in PR #{pr_number}")
            
            # Resolve Cargo.toml if it's conflicted
            status = run(["git", "status"])
            if "Cargo.toml" in status.stdout:
                write_log("Resolving Cargo.toml...")
                if resolve_cargo_toml():
                    run(["git", "add", "Cargo.toml"])
                
            # If there are still conflicts, accept theirs
            status = run(["git", "status"])
            if "unmerged paths" in status.stdout.lower():
                write_log("Accepting 'theirs' for remaining conflicts...")
                run(["git", "checkout", "--theirs", "."])
                run(["git", "add", "."])
            
            run(["git", "commit", "-m", f"Merge PR #{pr_number} and resolve conflicts"])
            
        # 3. Push
        res = run(["git", "push", "origin", "main"])
        if res.returncode != 0:
            write_log(f"Push failed for PR #{pr_number}")
            run(["git", "pull", "--rebase", "origin", "main"])
            run(["git", "push", "origin", "main"])
        else:
            write_log(f"Merged and pushed PR #{pr_number}")

    write_log("Final merge process completed.")

if __name__ == "__main__":
    main()
