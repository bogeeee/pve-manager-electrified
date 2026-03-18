Ext.define('PVE.qemu.DisplayInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    xtype: 'pveDisplayInputPanel',
    onlineHelp: 'qm_display',

    onGetValues: function (values) {
        let ret = PVE.Parser.printPropertyString(values, 'type');
        if (ret === '') {
            return { delete: 'vga' };
        }
        return { vga: ret };
    },

    viewModel: {
        data: {
            type: '__default__',
            clipboard: '__default__',
        },
        formulas: {
            matchNonGUIOption: function (get) {
                return get('type').match(/^(serial\d|none)$/);
            },
            memoryEmptyText: function (get) {
                let val = get('type');
                if (val === 'cirrus') {
                    return '4';
                } else if (val === 'std' || val.match(/^qxl\d?$/) || val === 'vmware') {
                    return '16';
                } else if (val.match(/^virtio/)) {
                    return '256';
                } else if (get('matchNonGUIOption')) {
                    return 'N/A';
                } else {
                    console.debug('unexpected display type', val);
                    return Proxmox.Utils.defaultText;
                }
            },
            isVNC: (get) => get('clipboard') === 'vnc',
            hideDefaultHint: (get) => get('isVNC') || get('matchNonGUIOption'),
            hideVNCHint: (get) => !get('isVNC') || get('matchNonGUIOption'),
        },
    },

    items: [
        {
            name: 'type',
            xtype: 'proxmoxKVComboBox',
            value: '__default__',
            deleteEmpty: false,
            fieldLabel: gettext('Graphic card'),
            comboItems: Object.entries(PVE.Utils.kvm_vga_drivers),
            validator: function (v) {
                let cfg = this.up('proxmoxWindowEdit').vmconfig || {};

                if (v.match(/^serial\d+$/) && (!cfg[v] || cfg[v] !== 'socket')) {
                    let fmt = gettext("Serial interface '{0}' is not correctly configured.");
                    return Ext.String.format(fmt, v);
                }
                return true;
            },
            bind: {
                value: '{type}',
            },
        },
        {
            xtype: 'proxmoxintegerfield',
            emptyText: Proxmox.Utils.defaultText,
            fieldLabel: gettext('Memory') + ' (MiB)',
            minValue: 4,
            maxValue: 512,
            step: 4,
            name: 'memory',
            bind: {
                emptyText: '{memoryEmptyText}',
                disabled: '{matchNonGUIOption}',
            },
        },
    ],

    advancedItems: [
        {
            xtype: 'proxmoxKVComboBox',
            name: 'clipboard',
            deleteEmpty: false,
            value: '__default__',
            fieldLabel: gettext('Clipboard'),
            comboItems: [
                ['__default__', Proxmox.Utils.defaultText],
                ['vnc', 'VNC'],
            ],
            bind: {
                value: '{clipboard}',
                disabled: '{matchNonGUIOption}',
            },
        },
        {
            xtype: 'displayfield',
            name: 'vncHint',
            userCls: 'pmx-hint',
            value:
                gettext(
                    'You cannot use the default SPICE clipboard if the VNC clipboard is selected.',
                ) +
                ' ' +
                gettext('VNC clipboard requires spice-tools installed in the Guest-VM.'),
            bind: {
                hidden: '{hideVNCHint}',
            },
        },
        {
            xtype: 'displayfield',
            name: 'vncMigration',
            userCls: 'pmx-hint',
            value: gettext(
                'You cannot live-migrate while using the VNC clipboard with machine versions older than 10.1.',
            ),
            bind: {
                hidden: '{hideVNCHint}',
            },
        },
        {
            xtype: 'displayfield',
            name: 'defaultHint',
            userCls: 'pmx-hint',
            value:
                gettext('This option depends on your display type.') +
                ' ' +
                gettext(
                    'If the display type uses SPICE you are able to use the default SPICE clipboard.',
                ),
            bind: {
                hidden: '{hideDefaultHint}',
            },
        },
    ],
});

Ext.define('PVE.qemu.DisplayEdit', {
    extend: 'Proxmox.window.Edit',

    vmconfig: undefined,

    subject: gettext('Display'),
    width: 350,

    items: [
        {
            xtype: 'pveDisplayInputPanel',
        },
    ],

    initComponent: function () {
        let me = this;

        me.callParent();

        me.load({
            success: function (response) {
                me.vmconfig = response.result.data;
                let vga = me.vmconfig.vga || '__default__';
                me.setValues(PVE.Parser.parsePropertyString(vga, 'type'));
            },
        });
    },
});
