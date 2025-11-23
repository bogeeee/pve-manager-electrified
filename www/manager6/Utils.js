Ext.ns('PVE');

console.log('Starting Proxmox VE Manager');

Ext.Ajax.defaultHeaders = {
    Accept: 'application/json',
};

Ext.define('PVE.Utils', {
    utilities: {
        // this singleton contains miscellaneous utilities

        toolkit: undefined, // (extjs|touch), set inside Toolkit.js

        bus_match: /^(ide|sata|virtio|scsi)(\d+)$/,

        log_severity_hash: {
            0: 'panic',
            1: 'alert',
            2: 'critical',
            3: 'error',
            4: 'warning',
            5: 'notice',
            6: 'info',
            7: 'debug',
        },

        support_level_hash: {
            c: gettext('Community'),
            b: gettext('Basic'),
            s: gettext('Standard'),
            p: gettext('Premium'),
        },

        noSubKeyHtml:
            'You do not have a valid subscription for this server. Please visit ' +
            '<a target="_blank" href="https://www.proxmox.com/en/proxmox-virtual-environment/pricing">' +
            'www.proxmox.com</a> to get a list of available options.',

        getClusterSubscriptionLevel: async function () {
            let { result } = await Proxmox.Async.api2({ url: '/cluster/status' });
            let levelMap = Object.fromEntries(
                result.data.filter((v) => v.type === 'node').map((v) => [v.name, v.level]),
            );
            return levelMap;
        },

        kvm_ostypes: {
            Linux: [
                { desc: '6.x - 2.6 Kernel', val: 'l26' },
                { desc: '2.4 Kernel', val: 'l24' },
            ],
            'Microsoft Windows': [
                { desc: '11/2022/2025', val: 'win11' },
                { desc: '10/2016/2019', val: 'win10' },
                { desc: '8.x/2012/2012r2', val: 'win8' },
                { desc: '7/2008r2', val: 'win7' },
                { desc: 'Vista/2008', val: 'w2k8' },
                { desc: 'XP/2003', val: 'wxp' },
                { desc: '2000', val: 'w2k' },
            ],
            'Solaris Kernel': [{ desc: '-', val: 'solaris' }],
            Other: [{ desc: '-', val: 'other' }],
        },

        is_windows: function (ostype) {
            for (let entry of PVE.Utils.kvm_ostypes['Microsoft Windows']) {
                if (entry.val === ostype) {
                    return true;
                }
            }
            return false;
        },

        get_health_icon: function (state, circle) {
            if (circle === undefined) {
                circle = false;
            }

            if (state === undefined) {
                state = 'uknown';
            }

            var icon = 'faded fa-question';
            switch (state) {
                case 'good':
                    icon = 'good fa-check';
                    break;
                case 'upgrade':
                    icon = 'warning fa-upload';
                    break;
                case 'old':
                    icon = 'warning fa-refresh';
                    break;
                case 'warning':
                    icon = 'warning fa-exclamation';
                    break;
                case 'critical':
                    icon = 'critical fa-times';
                    break;
                default:
                    break;
            }

            if (circle) {
                icon += '-circle';
            }

            return icon;
        },

        parse_ceph_version: function (service) {
            if (service.ceph_version_short) {
                return service.ceph_version_short;
            }

            if (service.ceph_version) {
                // See PVE/Ceph/Tools.pm - get_local_version
                const match = service.ceph_version.match(/^ceph.*\sv?(\d+(?:\.\d+)+)/);
                if (match) {
                    return match[1];
                }
            }

            return undefined;
        },

        compare_ceph_versions: function (a, b) {
            let avers = [];
            let bvers = [];

            if (a === b) {
                return 0;
            }

            if (Ext.isArray(a)) {
                avers = a.slice(); // copy array
            } else {
                avers = a.toString().split('.');
            }

            if (Ext.isArray(b)) {
                bvers = b.slice(); // copy array
            } else {
                bvers = b.toString().split('.');
            }

            for (;;) {
                let av = avers.shift();
                let bv = bvers.shift();

                if (av === undefined && bv === undefined) {
                    return 0;
                } else if (av === undefined) {
                    return -1;
                } else if (bv === undefined) {
                    return 1;
                } else {
                    let diff = parseInt(av, 10) - parseInt(bv, 10);
                    if (diff !== 0) {
                        return diff;
                    }
                    // else we need to look at the next parts
                }
            }
        },

        get_ceph_icon_html: function (health, fw) {
            var state = PVE.Utils.map_ceph_health[health];
            var cls = PVE.Utils.get_health_icon(state);
            if (fw) {
                cls += ' fa-fw';
            }
            return "<i class='fa " + cls + "'></i> ";
        },

        map_ceph_health: {
            HEALTH_OK: 'good',
            HEALTH_UPGRADE: 'upgrade',
            HEALTH_OLD: 'old',
            HEALTH_WARN: 'warning',
            HEALTH_ERR: 'critical',
        },

        render_sdn_pending: function (rec, value, key, index) {
            if (rec.data.state === undefined || rec.data.state === null) {
                return Ext.htmlEncode(value);
            }

            if (rec.data.state === 'deleted') {
                if (value === undefined) {
                    return ' ';
                } else {
                    return `<span style="text-decoration: line-through;">${Ext.htmlEncode(value)}</span>`;
                }
            } else if (rec.data.pending[key] !== undefined && rec.data.pending[key] !== null) {
                if (rec.data.pending[key] === 'deleted') {
                    return ' ';
                } else {
                    return Ext.htmlEncode(rec.data.pending[key]);
                }
            }
            return Ext.htmlEncode(value);
        },

        render_sdn_pending_state: function (rec, value) {
            if (value === undefined || value === null) {
                return ' ';
            }

            let icon = `<i class="fa fa-fw fa-refresh warning"></i>`;

            if (value === 'deleted') {
                return `<span>${icon}${Ext.htmlEncode(value)}</span>`;
            }

            let tip = gettext('Pending Changes') + ': <br>';

            for (const [key, keyvalue] of Object.entries(rec.data.pending)) {
                if (
                    (rec.data[key] !== undefined && rec.data.pending[key] !== rec.data[key]) ||
                    rec.data[key] === undefined
                ) {
                    tip += `${Ext.htmlEncode(key)}: ${Ext.htmlEncode(keyvalue)} <br>`;
                }
            }
            return `<span data-qtip="${Ext.htmlEncode(tip)}">${icon}${Ext.htmlEncode(value)}</span>`;
        },

        render_ceph_health: function (healthObj) {
            var state = {
                iconCls: PVE.Utils.get_health_icon(),
                text: '',
            };

            if (!healthObj || !healthObj.status) {
                return state;
            }

            var health = PVE.Utils.map_ceph_health[healthObj.status];

            state.iconCls = PVE.Utils.get_health_icon(health, true);
            state.text = healthObj.status;

            return state;
        },

        render_zfs_health: function (value) {
            if (typeof value === 'undefined') {
                return '';
            }
            var iconCls = 'question-circle';
            switch (value) {
                case 'AVAIL':
                case 'ONLINE':
                    iconCls = 'check-circle good';
                    break;
                case 'REMOVED':
                case 'DEGRADED':
                    iconCls = 'exclamation-circle warning';
                    break;
                case 'UNAVAIL':
                case 'FAULTED':
                case 'OFFLINE':
                    iconCls = 'times-circle critical';
                    break;
                default: //unknown
            }

            return '<i class="fa fa-' + iconCls + '"></i> ' + value;
        },

        render_pbs_fingerprint: (fp) => fp.substring(0, 23),

        render_backup_encryption: function (v, meta, record) {
            if (!v) {
                return gettext('No');
            }

            let tip = '';
            if (v.match(/^[a-fA-F0-9]{2}:/)) {
                // fingerprint
                tip = `Key fingerprint ${PVE.Utils.render_pbs_fingerprint(v)}`;
            }
            let icon = `<i class="fa fa-fw fa-lock good"></i>`;
            return `<span data-qtip="${tip}">${icon} ${gettext('Encrypted')}</span>`;
        },

        render_backup_verification: function (v, meta, record) {
            let i = (cls, txt) => `<i class="fa fa-fw fa-${cls}"></i> ${txt}`;
            if (v === undefined || v === null) {
                return i('question-circle-o warning', gettext('None'));
            }
            let tip = '';
            let txt = gettext('Failed');
            let iconCls = 'times critical';
            if (v.state === 'ok') {
                txt = gettext('OK');
                iconCls = 'check good';
                let now = Date.now() / 1000;
                let task = Proxmox.Utils.parse_task_upid(v.upid);
                let verify_time = Proxmox.Utils.render_timestamp(task.starttime);
                tip = `Last verify task started on ${verify_time}`;
                if (now - v.starttime > 30 * 24 * 60 * 60) {
                    tip = `Last verify task over 30 days ago: ${verify_time}`;
                    iconCls = 'check warning';
                }
            }
            return `<span data-qtip="${tip}"> ${i(iconCls, txt)} </span>`;
        },

        render_backup_status: function (value, meta, record) {
            if (typeof value === 'undefined') {
                return '';
            }

            let iconCls = 'check-circle good';
            let text = gettext('Yes');

            if (!PVE.Parser.parseBoolean(value.toString())) {
                iconCls = 'times-circle critical';

                text = gettext('No');

                let reason = record.get('reason');
                if (typeof reason !== 'undefined') {
                    if (reason in PVE.Utils.backup_reasons_table) {
                        reason = PVE.Utils.backup_reasons_table[record.get('reason')];
                    }
                    text = `${text} - ${reason}`;
                }
            }

            return `<i class="fa fa-${iconCls}"></i> ${text}`;
        },

        render_backup_days_of_week: function (val) {
            var dows = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
            var selected = [];
            var cur = -1;
            val.split(',').forEach(function (day) {
                cur++;
                var dow = (dows.indexOf(day) + 6) % 7;
                if (cur === dow) {
                    if (selected.length === 0 || selected[selected.length - 1] === 0) {
                        selected.push(1);
                    } else {
                        selected[selected.length - 1]++;
                    }
                } else {
                    while (cur < dow) {
                        cur++;
                        selected.push(0);
                    }
                    selected.push(1);
                }
            });

            cur = -1;
            var days = [];
            selected.forEach(function (item) {
                cur++;
                if (item > 2) {
                    days.push(
                        Ext.Date.dayNames[cur + 1] + '-' + Ext.Date.dayNames[(cur + item) % 7],
                    );
                    cur += item - 1;
                } else if (item === 2) {
                    days.push(Ext.Date.dayNames[cur + 1]);
                    days.push(Ext.Date.dayNames[(cur + 2) % 7]);
                    cur++;
                } else if (item === 1) {
                    days.push(Ext.Date.dayNames[(cur + 1) % 7]);
                }
            });
            return days.join(', ');
        },

        render_backup_selection: function (value, metaData, record) {
            let allExceptText = gettext('All except {0}');
            let allText = '-- ' + gettext('All') + ' --';
            if (record.data.all) {
                if (record.data.exclude) {
                    return Ext.String.format(allExceptText, record.data.exclude);
                }
                return allText;
            }
            if (record.data.vmid) {
                return record.data.vmid;
            }

            if (record.data.pool) {
                return "Pool '" + record.data.pool + "'";
            }

            return '-';
        },

        backup_reasons_table: {
            'backup=yes': gettext('Enabled'),
            'backup=no': gettext('Disabled'),
            enabled: gettext('Enabled'),
            disabled: gettext('Disabled'),
            'not a volume': gettext('Not a volume'),
            'efidisk but no OMVF BIOS': gettext('EFI Disk without OMVF BIOS'),
        },

        renderNotFound: (what) => Ext.String.format(gettext('No {0} found'), what),

        get_kvm_osinfo: function (value) {
            var info = { base: 'Other' }; // default
            if (value) {
                Ext.each(Object.keys(PVE.Utils.kvm_ostypes), function (k) {
                    Ext.each(PVE.Utils.kvm_ostypes[k], function (e) {
                        if (e.val === value) {
                            info = { desc: e.desc, base: k };
                        }
                    });
                });
            }
            return info;
        },

        render_kvm_ostype: function (value) {
            var osinfo = PVE.Utils.get_kvm_osinfo(value);
            if (osinfo.desc && osinfo.desc !== '-') {
                return osinfo.base + ' ' + osinfo.desc;
            } else {
                return osinfo.base;
            }
        },

        render_hotplug_features: function (value) {
            var fa = [];

            if (!value || value === '0') {
                return gettext('Disabled');
            }

            if (value === '1') {
                value = 'disk,network,usb';
            }

            Ext.each(value.split(','), function (el) {
                if (el === 'disk') {
                    fa.push(gettext('Disk'));
                } else if (el === 'network') {
                    fa.push(gettext('Network'));
                } else if (el === 'usb') {
                    fa.push('USB');
                } else if (el === 'memory') {
                    fa.push(gettext('Memory'));
                } else if (el === 'cpu') {
                    fa.push(gettext('CPU'));
                } else {
                    fa.push(el);
                }
            });

            return fa.join(', ');
        },

        render_localtime: function (value) {
            if (value === '__default__') {
                return Proxmox.Utils.defaultText + ' (' + gettext('Enabled for Windows') + ')';
            }
            return Proxmox.Utils.format_boolean(value);
        },

        render_qga_features: function (config) {
            if (!config) {
                return Proxmox.Utils.defaultText + ' (' + Proxmox.Utils.disabledText + ')';
            }
            let qga = PVE.Parser.parsePropertyString(config, 'enabled');
            if (!PVE.Parser.parseBoolean(qga.enabled)) {
                return Proxmox.Utils.disabledText;
            }
            delete qga.enabled;

            let agentstring = Proxmox.Utils.enabledText;

            for (const [key, value] of Object.entries(qga)) {
                let displayText = Proxmox.Utils.disabledText;
                if (key === 'type') {
                    let map = {
                        isa: 'ISA',
                        virtio: 'VirtIO',
                    };
                    displayText = map[value] || Proxmox.Utils.unknownText;
                } else if (key === 'freeze-fs-on-backup' && PVE.Parser.parseBoolean(value)) {
                    continue;
                } else if (PVE.Parser.parseBoolean(value)) {
                    displayText = Proxmox.Utils.enabledText;
                }
                agentstring += `, ${key}: ${displayText}`;
            }

            return agentstring;
        },

        render_qemu_machine: function (value) {
            return value || Proxmox.Utils.defaultText + ' (i440fx)';
        },

        render_qemu_bios: function (value) {
            if (!value) {
                return Proxmox.Utils.defaultText + ' (SeaBIOS)';
            } else if (value === 'seabios') {
                return 'SeaBIOS';
            } else if (value === 'ovmf') {
                return 'OVMF (UEFI)';
            } else {
                return value;
            }
        },

        render_dc_ha_opts: function (value) {
            if (!value) {
                return Proxmox.Utils.defaultText;
            } else {
                return PVE.Parser.printPropertyString(value);
            }
        },
        render_as_property_string: (v) =>
            !v ? Proxmox.Utils.defaultText : PVE.Parser.printPropertyString(v),

        render_scsihw: function (value) {
            if (!value || value === '__default__') {
                return Proxmox.Utils.defaultText + ' (LSI 53C895A)';
            } else if (value === 'lsi') {
                return 'LSI 53C895A';
            } else if (value === 'lsi53c810') {
                return 'LSI 53C810';
            } else if (value === 'megasas') {
                return 'MegaRAID SAS 8708EM2';
            } else if (value === 'virtio-scsi-pci') {
                return 'VirtIO SCSI';
            } else if (value === 'virtio-scsi-single') {
                return 'VirtIO SCSI single';
            } else if (value === 'pvscsi') {
                return 'VMware PVSCSI';
            } else {
                return value;
            }
        },

        render_spice_enhancements: function (values) {
            let props = PVE.Parser.parsePropertyString(values);
            if (Ext.Object.isEmpty(props)) {
                return Proxmox.Utils.noneText;
            }

            let output = [];
            if (PVE.Parser.parseBoolean(props.foldersharing)) {
                output.push('Folder Sharing: ' + gettext('Enabled'));
            }
            if (props.videostreaming === 'all' || props.videostreaming === 'filter') {
                output.push('Video Streaming: ' + props.videostreaming);
            }
            return output.join(', ');
        },

        // fixme: auto-generate this
        // for now, please keep in sync with PVE::Tools::kvmkeymaps
        kvm_keymaps: {
            __default__: Proxmox.Utils.defaultText,
            //ar: 'Arabic',
            da: 'Danish',
            de: 'German',
            'de-ch': 'German (Swiss)',
            'en-gb': 'English (UK)',
            'en-us': 'English (USA)',
            es: 'Spanish',
            //et: 'Estonia',
            fi: 'Finnish',
            //fo: 'Faroe Islands',
            fr: 'French',
            'fr-be': 'French (Belgium)',
            'fr-ca': 'French (Canada)',
            'fr-ch': 'French (Swiss)',
            //hr: 'Croatia',
            hu: 'Hungarian',
            is: 'Icelandic',
            it: 'Italian',
            ja: 'Japanese',
            lt: 'Lithuanian',
            //lv: 'Latvian',
            mk: 'Macedonian',
            nl: 'Dutch',
            //'nl-be': 'Dutch (Belgium)',
            no: 'Norwegian',
            pl: 'Polish',
            pt: 'Portuguese',
            'pt-br': 'Portuguese (Brazil)',
            //ru: 'Russian',
            sl: 'Slovenian',
            sv: 'Swedish',
            //th: 'Thai',
            tr: 'Turkish',
        },

        kvm_vga_drivers: {
            __default__: Proxmox.Utils.defaultText,
            std: gettext('Standard VGA'),
            vmware: gettext('VMware compatible'),
            qxl: 'SPICE',
            qxl2: 'SPICE dual monitor',
            qxl3: 'SPICE three monitors',
            qxl4: 'SPICE four monitors',
            serial0: gettext('Serial terminal') + ' 0',
            serial1: gettext('Serial terminal') + ' 1',
            serial2: gettext('Serial terminal') + ' 2',
            serial3: gettext('Serial terminal') + ' 3',
            virtio: 'VirtIO-GPU',
            'virtio-gl': 'VirGL GPU',
            none: Proxmox.Utils.noneText,
        },

        render_kvm_language: function (value) {
            if (!value || value === '__default__') {
                return Proxmox.Utils.defaultText;
            }
            let text = PVE.Utils.kvm_keymaps[value];
            return text ? `${text} (${value})` : value;
        },

        console_map: {
            __default__: Proxmox.Utils.defaultText + ' (xterm.js)',
            vv: 'SPICE (remote-viewer)',
            html5: 'HTML5 (noVNC)',
            xtermjs: 'xterm.js',
        },

        render_console_viewer: function (value) {
            value = value || '__default__';
            return PVE.Utils.console_map[value] || value;
        },

        render_kvm_vga_driver: function (value) {
            if (!value) {
                return Proxmox.Utils.defaultText;
            }
            let vga = PVE.Parser.parsePropertyString(value, 'type');
            let text = PVE.Utils.kvm_vga_drivers[vga.type];
            if (!vga.type) {
                text = Proxmox.Utils.defaultText;
            }
            return text ? `${text} (${value})` : value;
        },

        render_kvm_startup: function (value) {
            var startup = PVE.Parser.parseStartup(value);

            var res = 'order=';
            if (startup.order === undefined) {
                res += 'any';
            } else {
                res += startup.order;
            }
            if (startup.up !== undefined) {
                res += ',up=' + startup.up;
            }
            if (startup.down !== undefined) {
                res += ',down=' + startup.down;
            }

            return res;
        },

        extractFormActionError: function (action) {
            var msg;
            switch (action.failureType) {
                case Ext.form.action.Action.CLIENT_INVALID:
                    msg = gettext('Form fields may not be submitted with invalid values');
                    break;
                case Ext.form.action.Action.CONNECT_FAILURE: {
                    msg = gettext('Connection error');
                    let resp = action.response;
                    if (resp.status && resp.statusText) {
                        msg += ' ' + resp.status + ': ' + resp.statusText;
                    }
                    break;
                }
                case Ext.form.action.Action.LOAD_FAILURE:
                case Ext.form.action.Action.SERVER_INVALID:
                    msg = Proxmox.Utils.extractRequestError(action.result, true);
                    break;
            }
            return msg;
        },

        contentTypes: {
            images: gettext('Disk image'),
            backup: gettext('Backup'),
            vztmpl: gettext('Container template'),
            iso: gettext('ISO image'),
            rootdir: gettext('Container'),
            snippets: gettext('Snippets'),
            import: gettext('Import'),
        },

        // volume can be a full volume info object, in which case the format parameter is ignored, or
        // you can pass the volume ID and format as separate string parameters.
        volume_is_qemu_backup: function (volume, format) {
            let volid, subtype;
            if (typeof volume === 'string') {
                volid = volume;
            } else if (typeof volume === 'object') {
                ({ volid, format, subtype } = volume);
            } else {
                console.error('internal error - unexpected type', volume);
            }
            return format === 'pbs-vm' || volid.match(':backup/vzdump-qemu-') || subtype === 'qemu';
        },

        volume_is_lxc_backup: function (volume) {
            return (
                volume.format === 'pbs-ct' ||
                volume.volid.match(':backup/vzdump-(lxc|openvz)-') ||
                volume.subtype === 'lxc'
            );
        },

        authSchema: {
            ad: {
                name: gettext('Active Directory Server'),
                ipanel: 'pveAuthADPanel',
                syncipanel: 'pveAuthLDAPSyncPanel',
                add: true,
                tfa: true,
                pwchange: true,
            },
            ldap: {
                name: gettext('LDAP Server'),
                ipanel: 'pveAuthLDAPPanel',
                syncipanel: 'pveAuthLDAPSyncPanel',
                add: true,
                tfa: true,
                pwchange: true,
            },
            openid: {
                name: gettext('OpenID Connect Server'),
                ipanel: 'pveAuthOpenIDPanel',
                add: true,
                tfa: false,
                pwchange: false,
                iconCls: 'pmx-itype-icon-openid-logo',
            },
            pam: {
                name: 'Linux PAM',
                ipanel: 'pveAuthBasePanel',
                add: false,
                tfa: true,
                pwchange: true,
            },
            pve: {
                name: 'Proxmox VE authentication server',
                ipanel: 'pveAuthBasePanel',
                add: false,
                tfa: true,
                pwchange: true,
            },
        },

        storageSchema: {
            dir: {
                name: Proxmox.Utils.directoryText,
                ipanel: 'DirInputPanel',
                faIcon: 'folder',
                backups: true,
            },
            lvm: {
                name: 'LVM',
                ipanel: 'LVMInputPanel',
                faIcon: 'folder',
                backups: false,
            },
            lvmthin: {
                name: 'LVM-Thin',
                ipanel: 'LvmThinInputPanel',
                faIcon: 'folder',
                backups: false,
            },
            btrfs: {
                name: 'BTRFS',
                ipanel: 'BTRFSInputPanel',
                faIcon: 'folder',
                backups: true,
            },
            nfs: {
                name: 'NFS',
                ipanel: 'NFSInputPanel',
                faIcon: 'building',
                backups: true,
            },
            cifs: {
                name: 'SMB/CIFS',
                ipanel: 'CIFSInputPanel',
                faIcon: 'building',
                backups: true,
            },
            iscsi: {
                name: 'iSCSI',
                ipanel: 'IScsiInputPanel',
                faIcon: 'building',
                backups: false,
            },
            cephfs: {
                name: 'CephFS',
                ipanel: 'CephFSInputPanel',
                faIcon: 'building',
                backups: true,
            },
            pvecephfs: {
                name: 'CephFS (PVE)',
                ipanel: 'CephFSInputPanel',
                hideAdd: true,
                faIcon: 'building',
                backups: true,
            },
            rbd: {
                name: 'RBD',
                ipanel: 'RBDInputPanel',
                faIcon: 'building',
                backups: false,
            },
            pveceph: {
                name: 'RBD (PVE)',
                ipanel: 'RBDInputPanel',
                hideAdd: true,
                faIcon: 'building',
                backups: false,
            },
            zfs: {
                name: 'ZFS over iSCSI',
                ipanel: 'ZFSInputPanel',
                faIcon: 'building',
                backups: false,
            },
            zfspool: {
                name: 'ZFS',
                ipanel: 'ZFSPoolInputPanel',
                faIcon: 'folder',
                backups: false,
            },
            pbs: {
                name: 'Proxmox Backup Server',
                ipanel: 'PBSInputPanel',
                faIcon: 'floppy-o',
                backups: true,
            },
            drbd: {
                name: 'DRBD',
                hideAdd: true,
                backups: false,
            },
            esxi: {
                name: 'ESXi',
                ipanel: 'ESXIInputPanel',
                faIcon: 'cloud-download',
                backups: false,
            },
        },

        sdnvnetSchema: {
            vnet: {
                name: 'vnet',
                faIcon: 'folder',
            },
        },

        sdnzoneSchema: {
            zone: {
                name: 'zone',
                hideAdd: true,
            },
            simple: {
                name: 'Simple',
                ipanel: 'SimpleInputPanel',
                faIcon: 'th',
            },
            vlan: {
                name: 'VLAN',
                ipanel: 'VlanInputPanel',
                faIcon: 'th',
            },
            qinq: {
                name: 'QinQ',
                ipanel: 'QinQInputPanel',
                faIcon: 'th',
            },
            vxlan: {
                name: 'VXLAN',
                ipanel: 'VxlanInputPanel',
                faIcon: 'th',
            },
            evpn: {
                name: 'EVPN',
                ipanel: 'EvpnInputPanel',
                faIcon: 'th',
            },
        },

        sdncontrollerSchema: {
            controller: {
                name: 'controller',
                hideAdd: true,
            },
            evpn: {
                name: 'evpn',
                ipanel: 'EvpnInputPanel',
                faIcon: 'crosshairs',
            },
            bgp: {
                name: 'bgp',
                ipanel: 'BgpInputPanel',
                faIcon: 'crosshairs',
            },
            isis: {
                name: 'isis',
                ipanel: 'IsisInputPanel',
                faIcon: 'crosshairs',
            },
        },

        sdnipamSchema: {
            ipam: {
                name: 'ipam',
                hideAdd: true,
            },
            pve: {
                name: 'PVE',
                ipanel: 'PVEIpamInputPanel',
                faIcon: 'th',
                hideAdd: true,
            },
            netbox: {
                name: 'Netbox',
                ipanel: 'NetboxInputPanel',
                faIcon: 'th',
            },
            phpipam: {
                name: 'PhpIpam',
                ipanel: 'PhpIpamInputPanel',
                faIcon: 'th',
            },
        },

        sdndnsSchema: {
            dns: {
                name: 'dns',
                hideAdd: true,
            },
            powerdns: {
                name: 'powerdns',
                ipanel: 'PowerdnsInputPanel',
                faIcon: 'th',
            },
        },

        format_sdnvnet_type: function (value, md, record) {
            var schema = PVE.Utils.sdnvnetSchema[value];
            if (schema) {
                return schema.name;
            }
            return Proxmox.Utils.unknownText;
        },

        format_sdnzone_type: function (value, md, record) {
            var schema = PVE.Utils.sdnzoneSchema[value];
            if (schema) {
                return schema.name;
            }
            return Proxmox.Utils.unknownText;
        },

        format_sdncontroller_type: function (value, md, record) {
            var schema = PVE.Utils.sdncontrollerSchema[value];
            if (schema) {
                return schema.name;
            }
            return Proxmox.Utils.unknownText;
        },

        format_sdnipam_type: function (value, md, record) {
            var schema = PVE.Utils.sdnipamSchema[value];
            if (schema) {
                return schema.name;
            }
            return Proxmox.Utils.unknownText;
        },

        format_sdndns_type: function (value, md, record) {
            var schema = PVE.Utils.sdndnsSchema[value];
            if (schema) {
                return schema.name;
            }
            return Proxmox.Utils.unknownText;
        },

        format_storage_type: function (value, md, record) {
            if (value === 'rbd') {
                value = !record || record.get('monhost') ? 'rbd' : 'pveceph';
            } else if (value === 'cephfs') {
                value = !record || record.get('monhost') ? 'cephfs' : 'pvecephfs';
            }

            let schema = PVE.Utils.storageSchema[value];
            return schema?.name ?? value;
        },

        format_ha: function (value) {
            var text = Proxmox.Utils.noneText;

            if (value.managed) {
                text = value.state || Proxmox.Utils.noneText;
            }

            return text;
        },

        format_content_types: function (value) {
            return value
                .split(',')
                .sort()
                .map(function (ct) {
                    return PVE.Utils.contentTypes[ct] || ct;
                })
                .join(', ');
        },

        render_storage_content: function (value, metaData, record) {
            let data = record.data;
            let result;
            if (Ext.isNumber(data.channel) && Ext.isNumber(data.id) && Ext.isNumber(data.lun)) {
                result =
                    'CH ' +
                    Ext.String.leftPad(data.channel, 2, '0') +
                    ' ID ' +
                    data.id +
                    ' LUN ' +
                    data.lun;
            } else if (data.content === 'import') {
                if (data.volid.match(/^.*?:import\//)) {
                    // dir-based storages
                    result = data.volid.replace(/^.*?:import\//, '');
                } else {
                    // esxi storage
                    result = data.volid.replace(/^.*?:/, '');
                }
            } else {
                result = data.volid.replace(/^.*?:(.*?\/)?/, '');
            }
            return Ext.String.htmlEncode(result);
        },

        render_serverity: function (value) {
            return PVE.Utils.log_severity_hash[value] || value;
        },

        calculate_hostcpu: function (data) {
            if (!(data.uptime && Ext.isNumeric(data.cpu))) {
                return -1;
            }

            if (data.type !== 'qemu' && data.type !== 'lxc') {
                return -1;
            }

            let node = PVE.data.ResourceStore.getNodeById(data.node);
            if (!Ext.isDefined(node) || node === null) {
                return -1;
            }
            var maxcpu = node.data.maxcpu || 1;

            if (!Ext.isNumeric(maxcpu) && maxcpu >= 1) {
                return -1;
            }

            return (data.cpu / maxcpu) * data.maxcpu;
        },

        render_hostcpu: function (value, metaData, record, rowIndex, colIndex, store) {
            if (!(record.data.uptime && Ext.isNumeric(record.data.cpu))) {
                return '';
            }

            if (record.data.type !== 'qemu' && record.data.type !== 'lxc') {
                return '';
            }

            let node = PVE.data.ResourceStore.getNodeById(record.data.node);
            if (!Ext.isDefined(node) || node === null) {
                return '';
            }
            var maxcpu = node.data.maxcpu || 1;

            if (!Ext.isNumeric(maxcpu) || maxcpu < 1) {
                return '';
            }

            var per = (record.data.cpu / maxcpu) * record.data.maxcpu * 100;
            const cpu_label = maxcpu > 1 ? 'CPUs' : 'CPU';

            return `${per.toFixed(1)}% of ${maxcpu} ${cpu_label}`;
        },

        render_bandwidth: function (value) {
            if (!Ext.isNumeric(value)) {
                return '';
            }

            return Proxmox.Utils.format_size(value) + '/s';
        },

        render_timestamp_human_readable: function (value) {
            return Ext.Date.format(new Date(value * 1000), 'l d F Y H:i:s');
        },

        // render a timestamp or pending
        render_next_event: function (value) {
            if (!value) {
                return '-';
            }
            let now = new Date(),
                next = new Date(value * 1000);
            if (next < now) {
                return gettext('pending');
            }
            return Proxmox.Utils.render_timestamp(value);
        },

        calculate_mem_usage: function (data) {
            if (!Ext.isNumeric(data.mem) || data.maxmem === 0 || data.uptime < 1) {
                return -1;
            }

            return data.mem / data.maxmem;
        },

        calculate_hostmem_usage: function (data) {
            if (data.type !== 'qemu' && data.type !== 'lxc') {
                return -1;
            }

            let node = PVE.data.ResourceStore.getNodeById(data.node);

            if (!Ext.isDefined(node) || node === null) {
                return -1;
            }
            var maxmem = node.data.maxmem || 0;

            if (!Ext.isNumeric(data.mem) || maxmem === 0 || data.uptime < 1) {
                return -1;
            }

            if (data.type === 'qemu' && Ext.isNumeric(data.memhost)) {
                return data.memhost / maxmem;
            }
            return data.mem / maxmem;
        },

        render_mem_usage_percent: function (value, metaData, record, rowIndex, colIndex, store) {
            if (!Ext.isNumeric(value) || value === -1) {
                return '';
            }
            if (value > 1) {
                // we got no percentage but bytes
                let mem = value;
                let maxmem = record.data.maxmem;
                if (!record.data.uptime || maxmem === 0 || !Ext.isNumeric(mem)) {
                    return '';
                }

                return ((mem * 100) / maxmem).toFixed(1) + ' %';
            }
            return (value * 100).toFixed(1) + ' %';
        },

        render_hostmem_usage_percent: function (
            value,
            metaData,
            record,
            rowIndex,
            colIndex,
            store,
        ) {
            if (!Ext.isNumeric(record.data.mem) || value === -1) {
                return '';
            }

            if (record.data.type !== 'qemu' && record.data.type !== 'lxc') {
                return '';
            }

            let node = PVE.data.ResourceStore.getNodeById(record.data.node);
            var maxmem = node.data.maxmem || 0;

            if (record.data.mem > 1) {
                // we got no percentage but bytes
                let mem = record.data.mem;
                if (record.data.type === 'qemu' && Ext.isNumeric(record.data.memhost)) {
                    mem = record.data.memhost;
                }
                if (!record.data.uptime || maxmem === 0 || !Ext.isNumeric(mem)) {
                    return '';
                }

                return ((mem * 100) / maxmem).toFixed(1) + ' %';
            }
            return (value * 100).toFixed(1) + ' %';
        },

        render_mem_usage: function (value, metaData, record, rowIndex, colIndex, store) {
            var mem = value;
            var maxmem = record.data.maxmem;

            if (!record.data.uptime) {
                return '';
            }

            if (!(Ext.isNumeric(mem) && maxmem)) {
                return '';
            }

            return Proxmox.Utils.render_size(value);
        },

        calculate_disk_usage: function (data) {
            if (
                !Ext.isNumeric(data.disk) ||
                ((data.type === 'qemu' || data.type === 'lxc') && data.uptime === 0) ||
                data.maxdisk === 0
            ) {
                return -1;
            }

            return data.disk / data.maxdisk;
        },

        render_disk_usage_percent: function (value, metaData, record, rowIndex, colIndex, store) {
            if (!Ext.isNumeric(value) || value === -1) {
                return '';
            }

            return (value * 100).toFixed(1) + ' %';
        },

        render_disk_usage: function (value, metaData, record, rowIndex, colIndex, store) {
            var disk = value;
            var maxdisk = record.data.maxdisk;
            var type = record.data.type;

            if (
                !Ext.isNumeric(disk) ||
                maxdisk === 0 ||
                ((type === 'qemu' || type === 'lxc') && record.data.uptime === 0)
            ) {
                return '';
            }

            return Proxmox.Utils.render_size(value);
        },

        get_object_icon_class: function (type, record) {
            var status = '';
            var objType = type;

            if (type === 'type') {
                // for folder view
                objType = record.groupbyid;
            } else if (record.template) {
                // templates
                objType = 'template';
                status = type;
            } else if (type === 'network') {
                const networkTypeMapping = {
                    fabric: 'fa fa-road',
                    zone: 'fa fa-th',
                };

                return networkTypeMapping[record['network-type']] ?? '';
            } else if (type === 'storage' && record.content === 'import') {
                return 'fa fa-cloud-download';
            } else {
                // everything else
                status = record.status + ' ha-' + record.hastate;
            }

            if (record.lock) {
                status += ' locked lock-' + record.lock;
            }

            var defaults = PVE.tree.ResourceTree.typeDefaults[objType];
            if (defaults && defaults.iconCls) {
                return defaults.iconCls + ' ' + status;
            }

            return '';
        },

        render_resource_type: function (value, metaData, record, rowIndex, colIndex, store) {
            var cls = PVE.Utils.get_object_icon_class(value, record.data);

            var fa = '<i class="fa-fw x-grid-icon-custom ' + cls + '"></i> ';

            if (value === 'network') {
                return fa + record.data['network-type'];
            }

            return fa + value;
        },

        render_support_level: function (value, metaData, record) {
            return PVE.Utils.support_level_hash[value] || '-';
        },

        render_upid: function (value, metaData, record) {
            var type = record.data.type;
            var id = record.data.id;

            return Ext.htmlEncode(Proxmox.Utils.format_task_description(type, id));
        },

        render_optional_url: function (value) {
            if (value && value.match(/^https?:\/\//)) {
                return '<a target="_blank" href="' + value + '">' + value + '</a>';
            }
            return value;
        },

        render_san: function (value) {
            var names = [];
            if (Ext.isArray(value)) {
                value.forEach(function (val) {
                    if (!Ext.isNumber(val)) {
                        names.push(val);
                    }
                });
                return names.join('<br>');
            }
            return value;
        },

        render_full_name: function (firstname, metaData, record) {
            var first = firstname || '';
            var last = record.data.lastname || '';
            return Ext.htmlEncode(first + ' ' + last);
        },

        // expecting the following format:
        // [v2:10.10.10.1:6802/2008,v1:10.10.10.1:6803/2008]
        render_ceph_osd_addr: function (value) {
            value = value.trim();
            if (value.startsWith('[') && value.endsWith(']')) {
                value = value.slice(1, -1); // remove []
            }
            value = value.replaceAll(',', '\n'); // split IPs in lines
            let retVal = '';
            for (const i of value.matchAll(/^(v[0-9]):(.*):([0-9]*)\/([0-9]*)$/gm)) {
                retVal += `${i[1]}: ${i[2]}:${i[3]}<br>`;
            }
            return retVal.length < 1 ? value : retVal;
        },

        windowHostname: function () {
            return window.location.hostname.replace(
                Proxmox.Utils.IP6_bracket_match,
                function (m, addr, offset, original) {
                    return addr;
                },
            );
        },

        openDefaultConsoleWindow: function (consoles, consoleType, vmid, nodename, vmname, cmd) {
            var dv = PVE.Utils.defaultViewer(consoles, consoleType);
            PVE.Utils.openConsoleWindow(dv, consoleType, vmid, nodename, vmname, cmd);
        },

        openConsoleWindow: function (viewer, consoleType, vmid, nodename, vmname, cmd) {
            if (vmid === undefined && (consoleType === 'kvm' || consoleType === 'lxc')) {
                throw 'missing vmid';
            }
            if (!nodename) {
                throw 'no nodename specified';
            }

            if (viewer === 'html5') {
                PVE.Utils.openVNCViewer(consoleType, vmid, nodename, vmname, cmd);
            } else if (viewer === 'xtermjs') {
                Proxmox.Utils.openXtermJsViewer(consoleType, vmid, nodename, vmname, cmd);
            } else if (viewer === 'vv') {
                let url = '/nodes/' + nodename + '/spiceshell';
                let params = {
                    proxy: PVE.Utils.windowHostname(),
                };
                if (consoleType === 'kvm') {
                    url = '/nodes/' + nodename + '/qemu/' + vmid.toString() + '/spiceproxy';
                } else if (consoleType === 'lxc') {
                    url = '/nodes/' + nodename + '/lxc/' + vmid.toString() + '/spiceproxy';
                } else if (consoleType === 'upgrade') {
                    params.cmd = 'upgrade';
                } else if (consoleType === 'cmd') {
                    params.cmd = cmd;
                } else if (consoleType !== 'shell') {
                    throw `unknown spice viewer type '${consoleType}'`;
                }
                PVE.Utils.openSpiceViewer(url, params);
            } else {
                throw `unknown viewer type '${viewer}'`;
            }
        },

        defaultViewer: function (consoles, type) {
            var allowSpice, allowXtermjs;

            if (consoles === true) {
                allowSpice = true;
                allowXtermjs = true;
            } else if (typeof consoles === 'object') {
                allowSpice = consoles.spice;
                allowXtermjs = !!consoles.xtermjs;
            }
            let dv = PVE.UIOptions.options.console || (type === 'kvm' ? 'vv' : 'xtermjs');
            if (dv === 'vv' && !allowSpice) {
                dv = allowXtermjs ? 'xtermjs' : 'html5';
            } else if (dv === 'xtermjs' && !allowXtermjs) {
                dv = allowSpice ? 'vv' : 'html5';
            }

            return dv;
        },

        openVNCViewer: function (vmtype, vmid, nodename, vmname, cmd) {
            let scaling = 'off';
            if (Proxmox.Utils.toolkit !== 'touch') {
                let sp = Ext.state.Manager.getProvider();
                scaling = sp.get('novnc-scaling', 'off');
            }
            var url = Ext.Object.toQueryString({
                console: vmtype, // kvm, lxc, upgrade or shell
                novnc: 1,
                vmid: vmid,
                vmname: vmname,
                node: nodename,
                resize: scaling,
                cmd: cmd,
            });
            var nw = window.open('?' + url, '_blank', 'innerWidth=745,innerheight=427');
            if (nw) {
                nw.focus();
            }
        },

        openSpiceViewer: function (url, params) {
            var downloadWithName = function (uri, name) {
                var link = Ext.DomHelper.append(document.body, {
                    tag: 'a',
                    href: uri,
                    css: 'display:none;visibility:hidden;height:0px;',
                });

                // Note: we need to tell Android, AppleWebKit and Chrome
                // the correct file name extension
                // but we do not set 'download' tag for other environments, because
                // It can have strange side effects (additional user prompt on firefox)
                if (navigator.userAgent.match(/Android|AppleWebKit|Chrome/i)) {
                    link.download = name;
                }

                if (link.fireEvent) {
                    link.fireEvent('onclick');
                } else {
                    let evt = document.createEvent('MouseEvents');
                    evt.initMouseEvent(
                        'click',
                        true,
                        true,
                        window,
                        1,
                        0,
                        0,
                        0,
                        0,
                        false,
                        false,
                        false,
                        false,
                        0,
                        null,
                    );
                    link.dispatchEvent(evt);
                }
            };

            Proxmox.Utils.API2Request({
                url: url,
                params: params,
                method: 'POST',
                failure: function (response, opts) {
                    Ext.Msg.alert('Error', response.htmlStatus);
                },
                success: function (response, opts) {
                    let cfg = response.result.data;
                    let raw = Object.entries(cfg).reduce(
                        (acc, [k, v]) => acc + `${k}=${v}\n`,
                        '[virt-viewer]\n',
                    );
                    let spiceDownload =
                        'data:application/x-virt-viewer;charset=UTF-8,' + encodeURIComponent(raw);
                    downloadWithName(spiceDownload, 'pve-spice.vv');
                },
            });
        },

        openTreeConsole: function (tree, record, item, index, e) {
            e.stopEvent();
            let nodename = record.data.node;
            let vmid = record.data.vmid;
            let vmname = record.data.name;
            if (record.data.type === 'qemu' && !record.data.template) {
                Proxmox.Utils.API2Request({
                    url: `/nodes/${nodename}/qemu/${vmid}/status/current`,
                    failure: (response) => Ext.Msg.alert('Error', response.htmlStatus),
                    success: function (response, opts) {
                        let conf = response.result.data;
                        let consoles = {
                            spice: !!conf.spice,
                            xtermjs: !!conf.serial,
                        };
                        PVE.Utils.openDefaultConsoleWindow(consoles, 'kvm', vmid, nodename, vmname);
                    },
                });
            } else if (record.data.type === 'lxc' && !record.data.template) {
                PVE.Utils.openDefaultConsoleWindow(true, 'lxc', vmid, nodename, vmname);
            }
        },

        // test automation helper
        call_menu_handler: function (menu, text) {
            let item = menu.query('menuitem').find((el) => el.text === text);
            if (item && item.handler) {
                item.handler();
            }
        },

        createCmdMenu: function (v, record, item, index, event) {
            event.stopEvent();
            if (!(v instanceof Ext.tree.View)) {
                v.select(record);
            }
            let menu;
            let type = record.data.type;

            if (record.data.template) {
                if (type === 'qemu' || type === 'lxc') {
                    menu = Ext.create('PVE.menu.TemplateMenu', {
                        pveSelNode: record,
                    });
                }
            } else if (type === 'qemu' || type === 'lxc' || type === 'node') {
                menu = Ext.create('PVE.' + type + '.CmdMenu', {
                    pveSelNode: record,
                    nodename: record.data.node,
                });
            } else if (type === 'tag') {
                menu = Ext.create('PVE.dc.TagCmdMenu', {
                    tag: record.data.tag,
                });
            } else if (record?.isRoot()) {
                menu = Ext.create('PVE.dc.CmdMenu', {
                    pveSelNode: record,
                    nodename: record.data.node,
                });
            } else {
                return undefined;
            }

            menu.showAt(event.getXY());
            return menu;
        },

        // helper for deleting field which are set to there default values
        delete_if_default: function (values, fieldname, default_val, create) {
            if (values[fieldname] === '' || values[fieldname] === default_val) {
                if (!create) {
                    if (values.delete) {
                        if (Ext.isArray(values.delete)) {
                            values.delete.push(fieldname);
                        } else {
                            values.delete += ',' + fieldname;
                        }
                    } else {
                        values.delete = fieldname;
                    }
                }

                delete values[fieldname];
            }
        },

        loadSSHKeyFromFile: function (file, callback) {
            // ssh-keygen produces ~ 740 bytes for a 4096 bit RSA key,  current max is 16 kbit, so assume:
            // 740 * 8 for max. 32kbit (5920 bytes), round upwards to 8192 bytes, leaves lots of comment space
            PVE.Utils.loadFile(file, callback, 8192);
        },

        loadFile: function (file, callback, maxSize) {
            maxSize = maxSize || 32 * 1024;
            if (file.size > maxSize) {
                Ext.Msg.alert(
                    gettext('Error'),
                    `${gettext('Invalid file size')}: ${file.size} > ${maxSize}`,
                );
                return;
            }
            let reader = new FileReader();
            reader.onload = (evt) => callback(evt.target.result);
            reader.readAsText(file);
        },

        loadTextFromFile: function (file, callback, maxBytes) {
            let maxSize = maxBytes || 8192;
            if (file.size > maxSize) {
                Ext.Msg.alert(gettext('Error'), gettext('Invalid file size: ') + file.size);
                return;
            }
            let reader = new FileReader();
            reader.onload = (evt) => callback(evt.target.result);
            reader.readAsText(file);
        },

        diskControllerMaxIDs: {
            ide: 4,
            sata: 6,
            scsi: 31,
            virtio: 16,
            unused: 256,
        },

        // types is either undefined (all busses), an array of busses, or a single bus
        forEachBus: function (types, func) {
            let busses = Object.keys(PVE.Utils.diskControllerMaxIDs);

            if (Ext.isArray(types)) {
                busses = types;
            } else if (Ext.isDefined(types)) {
                busses = [types];
            }

            // check if we only have valid busses
            for (let i = 0; i < busses.length; i++) {
                if (!PVE.Utils.diskControllerMaxIDs[busses[i]]) {
                    throw "invalid bus: '" + busses[i] + "'";
                }
            }

            for (let i = 0; i < busses.length; i++) {
                let count = PVE.Utils.diskControllerMaxIDs[busses[i]];
                for (let j = 0; j < count; j++) {
                    let cont = func(busses[i], j);
                    if (!cont && cont !== undefined) {
                        return;
                    }
                }
            }
        },

        lxc_mp_counts: {
            mp: 256,
            unused: 256,
        },

        forEachLxcMP: function (func, includeUnused) {
            for (let i = 0; i < PVE.Utils.lxc_mp_counts.mp; i++) {
                let cont = func('mp', i, `mp${i}`);
                if (!cont && cont !== undefined) {
                    return;
                }
            }

            if (!includeUnused) {
                return;
            }

            for (let i = 0; i < PVE.Utils.lxc_mp_counts.unused; i++) {
                let cont = func('unused', i, `unused${i}`);
                if (!cont && cont !== undefined) {
                    return;
                }
            }
        },

        lxc_dev_count: 256,

        forEachLxcDev: function (func) {
            for (let i = 0; i < PVE.Utils.lxc_dev_count; i++) {
                let cont = func(i, `dev${i}`);
                if (!cont && cont !== undefined) {
                    return;
                }
            }
        },

        hardware_counts: {
            net: 32,
            usb: 14,
            usb_old: 5,
            hostpci: 16,
            audio: 1,
            efidisk: 1,
            serial: 4,
            rng: 1,
            tpmstate: 1,
            virtiofs: 10,
        },

        // we can have usb6 and up only for specific machine/ostypes
        get_max_usb_count: function (ostype, machine) {
            if (!ostype) {
                return PVE.Utils.hardware_counts.usb_old;
            }

            let match = /-(\d+).(\d+)/.exec(machine ?? '');
            if (!match || PVE.Utils.qemu_min_version([match[1], match[2]], [7, 1])) {
                if (ostype === 'l26') {
                    return PVE.Utils.hardware_counts.usb;
                }
                let os_match = /^win(\d+)$/.exec(ostype);
                if (os_match && os_match[1] > 7) {
                    return PVE.Utils.hardware_counts.usb;
                }
            }

            return PVE.Utils.hardware_counts.usb_old;
        },

        // parameters are expected to be arrays, e.g. [7,1], [4,0,1]
        // returns true if toCheck is equal or greater than minVersion
        qemu_min_version: function (toCheck, minVersion) {
            let i;
            for (i = 0; i < toCheck.length && i < minVersion.length; i++) {
                if (toCheck[i] < minVersion[i]) {
                    return false;
                }
            }

            if (minVersion.length > toCheck.length) {
                for (; i < minVersion.length; i++) {
                    if (minVersion[i] !== 0) {
                        return false;
                    }
                }
            }

            return true;
        },

        cleanEmptyObjectKeys: function (obj) {
            for (const propName of Object.keys(obj)) {
                if (obj[propName] === null || obj[propName] === undefined) {
                    delete obj[propName];
                }
            }
        },

        acmedomain_count: 5,

        add_domain_to_acme: function (acme, domain) {
            if (acme.domains === undefined) {
                acme.domains = [domain];
            } else {
                acme.domains.push(domain);
                acme.domains = acme.domains.filter(
                    (value, index, self) => self.indexOf(value) === index,
                );
            }
            return acme;
        },

        remove_domain_from_acme: function (acme, domain) {
            if (acme.domains !== undefined) {
                acme.domains = acme.domains.filter(
                    (value, index, self) => self.indexOf(value) === index && value !== domain,
                );
            }
            return acme;
        },

        handleStoreErrorOrMask: function (view, store, regex, callback) {
            view.mon(store, 'load', function (proxy, response, success, operation) {
                if (success) {
                    Proxmox.Utils.setErrorMask(view, false);
                    return;
                }
                let msg;
                if (operation.error.statusText) {
                    if (operation.error.statusText.match(regex)) {
                        callback(view, operation.error);
                        return;
                    } else {
                        msg = operation.error.statusText + ' (' + operation.error.status + ')';
                    }
                } else {
                    msg = gettext('Connection error');
                }
                Proxmox.Utils.setErrorMask(view, Ext.htmlEncode(msg));
            });
        },

        showCephInstallOrMask: function (container, msg, nodename, callback) {
            if (msg.match(/not (installed|initialized)/i)) {
                if (Proxmox.UserName === 'root@pam') {
                    container.el.mask();
                    if (!container.down('pveCephInstallWindow')) {
                        let isInstalled = !!msg.match(/not initialized/i);
                        let win = Ext.create('PVE.ceph.Install', {
                            nodename: nodename,
                        });
                        win.getViewModel().set('isInstalled', isInstalled);
                        container.add(win);
                        win.on('close', () => {
                            container.el.unmask();
                        });
                        win.show();
                        callback(win);
                    }
                } else {
                    container.mask(
                        Ext.String.format(
                            gettext('{0} not installed.') +
                                ' ' +
                                gettext('Log in as root to install.'),
                            'Ceph',
                        ),
                        ['pve-static-mask'],
                    );
                }
                return true;
            } else {
                return false;
            }
        },

        monitor_ceph_installed: function (view, rstore, nodename, maskOwnerCt) {
            PVE.Utils.handleStoreErrorOrMask(
                view,
                rstore,
                /not (installed|initialized)/i,
                (_, error) => {
                    nodename = nodename || Proxmox.NodeName;
                    let maskTarget = maskOwnerCt ? view.ownerCt : view;
                    rstore.stopUpdate();
                    PVE.Utils.showCephInstallOrMask(
                        maskTarget,
                        error.statusText,
                        nodename,
                        (win) => {
                            view.mon(win, 'cephInstallWindowClosed', () => rstore.startUpdate());
                        },
                    );
                },
            );
        },

        propertyStringSet: function (target, source, name, value) {
            if (source) {
                if (value === undefined) {
                    target[name] = source;
                } else {
                    target[name] = value;
                }
            } else {
                delete target[name];
            }
        },

        forEachCorosyncLink: function (nodeinfo, cb) {
            let re = /(?:ring|link)(\d+)_addr/;
            Ext.iterate(nodeinfo, (prop, val) => {
                let match = re.exec(prop);
                if (match) {
                    cb(Number(match[1]), val);
                }
            });
        },

        cpu_vendor_map: {
            default: 'QEMU',
            AuthenticAMD: 'AMD',
            GenuineIntel: 'Intel',
        },

        cpu_vendor_order: {
            AMD: 1,
            Intel: 2,
            QEMU: 3,
            Host: 4,
            _default_: 5, // includes custom models
        },

        verify_ip64_address_list: function (value, with_suffix) {
            for (let addr of value.split(/[ ,;]+/)) {
                if (addr === '') {
                    continue;
                }

                if (with_suffix) {
                    let parts = addr.split('%');
                    addr = parts[0];

                    if (parts.length > 2) {
                        return false;
                    }

                    if (parts.length > 1 && !addr.startsWith('fe80:')) {
                        return false;
                    }
                }

                if (!Proxmox.Utils.IP64_match.test(addr)) {
                    return false;
                }
            }

            return true;
        },

        sortByPreviousUsage: function (vmconfig, controllerList) {
            if (!controllerList) {
                controllerList = ['ide', 'virtio', 'scsi', 'sata'];
            }
            let usedControllers = {};
            for (const type of Object.keys(PVE.Utils.diskControllerMaxIDs)) {
                usedControllers[type] = 0;
            }

            for (const property of Object.keys(vmconfig)) {
                if (
                    property.match(PVE.Utils.bus_match) &&
                    !vmconfig[property].match(/media=cdrom/)
                ) {
                    const foundController = property.match(PVE.Utils.bus_match)[1];
                    usedControllers[foundController]++;
                }
            }

            let sortPriority = PVE.qemu.OSDefaults.getDefaults(vmconfig.ostype).busPriority;

            let sortedList = Ext.clone(controllerList);
            sortedList.sort(function (a, b) {
                if (usedControllers[b] === usedControllers[a]) {
                    return sortPriority[b] - sortPriority[a];
                }
                return usedControllers[b] - usedControllers[a];
            });

            return sortedList;
        },

        nextFreeDisk: function (controllers, config) {
            for (const controller of controllers) {
                for (let i = 0; i < PVE.Utils.diskControllerMaxIDs[controller]; i++) {
                    let confid = controller + i.toString();
                    if (!Ext.isDefined(config[confid])) {
                        return {
                            controller,
                            id: i,
                            confid,
                        };
                    }
                }
            }

            return undefined;
        },

        nextFreeLxcMP: function (type, config) {
            for (let i = 0; i < PVE.Utils.lxc_mp_counts[type]; i++) {
                let confid = `${type}${i}`;
                if (!Ext.isDefined(config[confid])) {
                    return {
                        type,
                        id: i,
                        confid,
                    };
                }
            }

            return undefined;
        },

        escapeNotesTemplate: function (value) {
            let replace = {
                '\\': '\\\\',
                '\n': '\\n',
            };
            return value.replace(/(\\|[\n])/g, (match) => replace[match]);
        },

        unEscapeNotesTemplate: function (value) {
            let replace = {
                '\\\\': '\\',
                '\\n': '\n',
            };
            return value.replace(/(\\\\|\\n)/g, (match) => replace[match]);
        },

        notesTemplateVars: ['cluster', 'guestname', 'node', 'vmid'],

        renderTags: function (tagstext, overrides) {
            let text = '';
            if (tagstext) {
                let tags = (tagstext.split(/[,; ]/) || []).filter((t) => !!t);
                if (PVE.UIOptions.shouldSortTags()) {
                    tags = tags.sort((a, b) => {
                        let alc = a.toLowerCase();
                        let blc = b.toLowerCase();
                        return alc < blc ? -1 : blc < alc ? 1 : a.localeCompare(b);
                    });
                }
                text += ' ';
                tags.forEach((tag) => {
                    text += Proxmox.Utils.getTagElement(tag, overrides);
                });
            }
            return text;
        },

        tagCharRegex: /^[a-z0-9+_.-]+$/i,

        verificationStateOrder: {
            failed: 0,
            none: 1,
            ok: 2,
            __default__: 3,
        },

        isStandaloneNode: function () {
            return PVE.data.ResourceStore.getNodes().length < 2;
        },

        // main use case of this helper is the login window
        getUiLanguage: function () {
            let languageCookie = Ext.util.Cookies.get('PVELangCookie');
            if (languageCookie === 'kr') {
                // fix-up 'kr' being used for Korean by mistake FIXME: remove with PVE 9
                let dt = Ext.Date.add(new Date(), Ext.Date.YEAR, 10);
                languageCookie = 'ko';
                Ext.util.Cookies.set('PVELangCookie', languageCookie, dt);
            }
            return languageCookie || Proxmox.defaultLang || 'en';
        },

        getFormattedGuestIdentifier: function (vmid, guestName) {
            if (PVE.UIOptions.getTreeSortingValue('sort-field') === 'vmid') {
                return guestName ? `${vmid} (${guestName})` : vmid;
            } else {
                return guestName ? `${guestName} (${vmid})` : vmid;
            }
        },

        formatGuestTaskConfirmation: function (taskType, vmid, guestName) {
            let description = Proxmox.Utils.format_task_description(
                taskType,
                this.getFormattedGuestIdentifier(vmid, guestName),
            );
            return Ext.htmlEncode(description);
        },
    },

    singleton: true,
    constructor: function () {
        var me = this;
        Ext.apply(me, me.utilities);

        Proxmox.Utils.override_task_descriptions({
            acmedeactivate: ['ACME Account', gettext('Deactivate')],
            acmenewcert: ['SRV', gettext('Order Certificate')],
            acmerefresh: ['ACME Account', gettext('Refresh')],
            acmeregister: ['ACME Account', gettext('Register')],
            acmerenew: ['SRV', gettext('Renew Certificate')],
            acmerevoke: ['SRV', gettext('Revoke Certificate')],
            acmeupdate: ['ACME Account', gettext('Update')],
            'auth-realm-sync': [gettext('Realm'), gettext('Sync')],
            'auth-realm-sync-test': [gettext('Realm'), gettext('Sync Preview')],
            'bulk-migrate': ['', gettext('Bulk migrate VMs and Containers')],
            'bulk-start': ['', gettext('Bulk start VMs and Containers')],
            'bulk-shutdown': ['', gettext('Bulk shutdown VMs and Containers')],
            'bulk-suspend': ['', gettext('Bulk shutdown VMs and Containers')],
            cephcreatemds: ['Ceph Metadata Server', gettext('Create')],
            cephcreatemgr: ['Ceph Manager', gettext('Create')],
            cephcreatemon: ['Ceph Monitor', gettext('Create')],
            cephcreateosd: ['Ceph OSD', gettext('Create')],
            cephcreatepool: ['Ceph Pool', gettext('Create')],
            cephdestroymds: ['Ceph Metadata Server', gettext('Destroy')],
            cephdestroymgr: ['Ceph Manager', gettext('Destroy')],
            cephdestroymon: ['Ceph Monitor', gettext('Destroy')],
            cephdestroyosd: ['Ceph OSD', gettext('Destroy')],
            cephdestroypool: ['Ceph Pool', gettext('Destroy')],
            cephdestroyfs: ['CephFS', gettext('Destroy')],
            cephfscreate: ['CephFS', gettext('Create')],
            cephsetpool: ['Ceph Pool', gettext('Edit')],
            cephsetflags: ['', gettext('Change global Ceph flags')],
            clustercreate: ['', gettext('Create Cluster')],
            clusterjoin: ['', gettext('Join Cluster')],
            dircreate: [gettext('Directory Storage'), gettext('Create')],
            dirremove: [gettext('Directory'), gettext('Remove')],
            download: [gettext('File'), gettext('Download')],
            hamigrate: ['HA', gettext('Migrate')],
            hashutdown: ['HA', gettext('Shutdown')],
            hastart: ['HA', gettext('Start')],
            hastop: ['HA', gettext('Stop')],
            imgcopy: ['', gettext('Copy data')],
            imgdel: ['', gettext('Erase data')],
            lvmcreate: [gettext('LVM Storage'), gettext('Create')],
            lvmremove: ['Volume Group', gettext('Remove')],
            lvmthincreate: [gettext('LVM-Thin Storage'), gettext('Create')],
            lvmthinremove: ['Thinpool', gettext('Remove')],
            migrateall: ['', gettext('Bulk migrate VMs and Containers')],
            move_volume: ['CT', gettext('Move Volume')],
            'pbs-download': ['VM/CT', gettext('File Restore Download')],
            pull_file: ['CT', gettext('Pull file')],
            push_file: ['CT', gettext('Push file')],
            qmclone: ['VM', gettext('Clone')],
            qmconfig: ['VM', gettext('Configure')],
            qmcreate: ['VM', gettext('Create')],
            qmdelsnapshot: ['VM', gettext('Delete Snapshot')],
            qmdestroy: ['VM', gettext('Destroy')],
            qmigrate: ['VM', gettext('Migrate')],
            qmmove: ['VM', gettext('Move disk')],
            qmpause: ['VM', gettext('Pause')],
            qmreboot: ['VM', gettext('Reboot')],
            qmreset: ['VM', gettext('Reset')],
            qmrestore: ['VM', gettext('Restore')],
            qmresume: ['VM', gettext('Resume')],
            qmrollback: ['VM', gettext('Rollback')],
            qmshutdown: ['VM', gettext('Shutdown')],
            qmsnapshot: ['VM', gettext('Snapshot')],
            qmstart: ['VM', gettext('Start')],
            qmstop: ['VM', gettext('Stop')],
            qmsuspend: ['VM', gettext('Hibernate')],
            qmtemplate: ['VM', gettext('Convert to template')],
            resize: ['VM/CT', gettext('Resize')],
            reloadnetworkall: ['', gettext('Reload network configuration on all nodes')],
            spiceproxy: ['VM/CT', gettext('Console') + ' (Spice)'],
            spiceshell: ['', gettext('Shell') + ' (Spice)'],
            startall: ['', gettext('Bulk start VMs and Containers')],
            stopall: ['', gettext('Bulk shutdown VMs and Containers')],
            suspendall: ['', gettext('Suspend all VMs')],
            unknownimgdel: ['', gettext('Destroy image from unknown guest')],
            wipedisk: ['Device', gettext('Wipe Disk')],
            vncproxy: ['VM/CT', gettext('Console')],
            vncshell: ['', gettext('Shell')],
            vzclone: ['CT', gettext('Clone')],
            vzcreate: ['CT', gettext('Create')],
            vzdelsnapshot: ['CT', gettext('Delete Snapshot')],
            vzdestroy: ['CT', gettext('Destroy')],
            vzdump: (type, id) =>
                id ? `VM/CT ${id} - ${gettext('Backup')}` : gettext('Backup Job'),
            vzmigrate: ['CT', gettext('Migrate')],
            vzmount: ['CT', gettext('Mount')],
            vzreboot: ['CT', gettext('Reboot')],
            vzrestore: ['CT', gettext('Restore')],
            vzresume: ['CT', gettext('Resume')],
            vzrollback: ['CT', gettext('Rollback')],
            vzshutdown: ['CT', gettext('Shutdown')],
            vzsnapshot: ['CT', gettext('Snapshot')],
            vzstart: ['CT', gettext('Start')],
            vzstop: ['CT', gettext('Stop')],
            vzsuspend: ['CT', gettext('Suspend')],
            vztemplate: ['CT', gettext('Convert to template')],
            vzumount: ['CT', gettext('Unmount')],
            zfscreate: [gettext('ZFS Storage'), gettext('Create')],
            zfsremove: ['ZFS Pool', gettext('Remove')],
        });

        Proxmox.Utils.overrideNotificationFieldName({
            'job-id': gettext('Job ID'),
        });

        Proxmox.Utils.overrideNotificationFieldValue({
            'package-updates': gettext('Package updates are available'),
            vzdump: gettext('Backup notifications'),
            replication: gettext('Replication job notifications'),
            fencing: gettext('Node fencing notifications'),
        });
    },
});
