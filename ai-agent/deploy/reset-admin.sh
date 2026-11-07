#!/usr/bin/env bash
# Pakai: bash deploy/reset-admin.sh [username] [password]   (default: adminn1 200309)
U="${1:-adminn1}"; P="${2:-200309}"; cd /opt/ai-agent
runuser -u aiagent -- env U="$U" P="$P" node -e "
const D=require('better-sqlite3'),c=require('crypto');const db=new D('data/app.db');
const s=c.randomBytes(16);const h=s.toString('hex')+':'+c.scryptSync(process.env.P,s,64).toString('hex');
db.prepare('delete from users where username=?').run(process.env.U);
db.prepare('insert into users(username,hash,role) values(?,?,?)').run(process.env.U,h,'admin');
console.log('Admin siap:',db.prepare('select id,username,role from users').all());"
