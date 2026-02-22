# AD Management Script V9
# Automates Active Directory user, group, and OU setup for the Draupnir environment.
#
# ===================================================================
# CUSTOMER GUIDE:
# 1. To add new users, modify the $testUsers array in Step 7
# 2. To add new groups, modify the group creation code in Step 8
# 3. To add users to groups, modify the group membership code in Step 9
# ===================================================================

param (
    [Parameter(Mandatory=$true)]
    [string]$DomainName,

    [Parameter(Mandatory=$false)]
    [string]$SecretId = "",

    [Parameter(Mandatory=$false)]
    [string]$AdminPassword,

    [Parameter(Mandatory=$false)]
    [string]$Region = "us-east-1",

    # Short name used for the top-level OU (defaults to first label of domain)
    [Parameter(Mandatory=$false)]
    [string]$OUName = ""
)

if (-not $OUName) {
    $OUName = $DomainName.Split('.')[0]
}

Write-Host "Starting AD Management Script V9"
Write-Host "Domain: $DomainName | OU: $OUName"

# Step 1: Install required modules
try {
    if (-not (Get-Module -ListAvailable -Name ActiveDirectory)) {
        Write-Host "Installing RSAT-AD-PowerShell..."
        Install-WindowsFeature RSAT-AD-PowerShell -Confirm:$false
    }
    Import-Module ActiveDirectory
} catch {
    Write-Host "Error installing modules: $_"; throw $_
}

# Step 2: Resolve admin password
try {
    if ($AdminPassword) {
        Write-Host "Using admin password provided as parameter"
        $adminPassword = $AdminPassword
    } else {
        Write-Host "Retrieving admin password from Secrets Manager (SecretId: $SecretId)..."
        Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force
        if (-not (Get-Module -ListAvailable -Name AWS.Tools.SecretsManager)) {
            Install-Module -Name AWS.Tools.SecretsManager -Force -AllowClobber -ErrorAction SilentlyContinue
        }
        Import-Module AWS.Tools.SecretsManager
        $secretValue = Get-SECSecretValue -SecretId $SecretId -Region $Region
        $adminPassword = $secretValue.SecretString
        if ($adminPassword -match '^\s*\{.*\}\s*$') {
            try {
                $json = $adminPassword | ConvertFrom-Json
                if ($json.password) { $adminPassword = $json.password }
            } catch {}
        }
    }
    $adminUsername = "Admin"
    Write-Host "Using username: $adminUsername"
} catch {
    Write-Host "Error retrieving password: $_"; exit 1
}

# Step 3: Build credentials
try {
    $domainUsername = "$DomainName\$adminUsername"
    $securePassword = ConvertTo-SecureString $adminPassword -AsPlainText -Force
    $cred = New-Object System.Management.Automation.PSCredential($domainUsername, $securePassword)
    Write-Host "Credentials created for: $domainUsername"
} catch {
    Write-Host "Error creating credentials: $_"; exit 1
}

Write-Host "Waiting 120s for domain controller to be fully operational..."
Start-Sleep -Seconds 120

# Step 4: Create AD PSDrive
try {
    if (Get-PSDrive -Name AD -ErrorAction SilentlyContinue) { Remove-PSDrive -Name AD -Force }
    New-PSDrive -Name AD -PSProvider ActiveDirectory -Server $DomainName -Credential $cred -Root "//RootDSE/" -Scope Global
    Write-Host "AD drive created"
} catch {
    Write-Host "Error creating AD drive: $_"; exit 1
}

# Step 5: Get domain info
try {
    $domainObj = Get-ADDomain -Server $DomainName -Credential $cred
    $domainDN = $domainObj.DistinguishedName
    Write-Host "Domain DN: $domainDN"
} catch {
    Write-Host "Error getting domain info: $_"; exit 1
}

# Step 6: Ensure OU structure exists
try {
    $parentOUPath = "OU=$OUName,$domainDN"
    $usersOUPath  = "OU=Users,$parentOUPath"

    if (-not (Get-ADOrganizationalUnit -Filter "DistinguishedName -eq '$parentOUPath'" -Server $DomainName -Credential $cred -ErrorAction SilentlyContinue)) {
        New-ADOrganizationalUnit -Name $OUName -Path $domainDN -Server $DomainName -Credential $cred
        Write-Host "Created OU: $OUName"
    }
    if (-not (Get-ADOrganizationalUnit -Filter "DistinguishedName -eq '$usersOUPath'" -Server $DomainName -Credential $cred -ErrorAction SilentlyContinue)) {
        New-ADOrganizationalUnit -Name "Users" -Path $parentOUPath -Server $DomainName -Credential $cred
        Write-Host "Created OU: Users"
    }
} catch {
    Write-Host "Error creating OUs: $_"
}

# Step 7: Create users
# ===================================================================
# CUSTOMER CONFIGURATION: Add or modify users in this array
# ===================================================================
try {
    $UserPassword = "Amazon1!"
    $secureUserPassword = ConvertTo-SecureString $UserPassword -AsPlainText -Force
    $testUsers = @("Test", "TestUser1", "TestUser2", "NewUser1", "NewUser2")

    foreach ($user in $testUsers) {
        if (-not (Get-ADUser -Filter "SamAccountName -eq '$user'" -Server $DomainName -Credential $cred -ErrorAction SilentlyContinue)) {
            New-ADUser -Name $user -SamAccountName $user -AccountPassword $secureUserPassword -Enabled $true -PasswordNeverExpires $true -Path $usersOUPath -Server $DomainName -Credential $cred
            Write-Host "Created user: $user"
        } else {
            Write-Host "User already exists: $user"
        }
    }
} catch {
    Write-Host "Error creating users: $_"
}

# Step 8: Create groups
# ===================================================================
# CUSTOMER CONFIGURATION: Add or modify groups here
# ===================================================================
try {
    if (-not (Get-ADGroup -Filter "SamAccountName -eq 'QuickSightAdmins'" -Server $DomainName -Credential $cred -ErrorAction SilentlyContinue)) {
        New-ADGroup -Name "QuickSight Admins" -SamAccountName "QuickSightAdmins" -GroupCategory Security -GroupScope Global -Path $usersOUPath -Server $DomainName -Credential $cred
        Write-Host "Created group: QuickSightAdmins"
    }
    if (-not (Get-ADGroup -Filter "SamAccountName -eq 'TestGroup'" -Server $DomainName -Credential $cred -ErrorAction SilentlyContinue)) {
        New-ADGroup -Name "Test Group" -SamAccountName "TestGroup" -GroupCategory Security -GroupScope Global -Path $usersOUPath -Server $DomainName -Credential $cred
        Write-Host "Created group: TestGroup"
    }
} catch {
    Write-Host "Error creating groups: $_"
}

# Step 9: Add users to groups
# ===================================================================
# CUSTOMER CONFIGURATION: Add or modify group memberships here
# ===================================================================
try {
    Add-ADGroupMember -Identity "TestGroup" -Members "Test" -Server $DomainName -Credential $cred -ErrorAction SilentlyContinue
    Write-Host "Added Test to TestGroup"
} catch {
    Write-Host "Error adding group members: $_"
}

# Step 10: List users (informational)
try {
    $allUsers = Get-ADUser -Filter * -Server $DomainName -Credential $cred
    Write-Host "Total users: $($allUsers.Count)"
    $allUsers | ForEach-Object { Write-Host "  - $($_.Name)" }
} catch {
    Write-Host "Error listing users: $_"
}

Write-Host "AD Management Script V9 completed successfully"
