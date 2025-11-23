Ext.define('PVE.qemu.VirtiofsInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    xtype: 'pveVirtiofsInputPanel',
    onlineHelp: 'qm_virtiofs',

    insideWizard: false,

    onGetValues: function (values) {
        var me = this;
        var confid = me.confid;
        var params = {};
        delete values.delete;
        params[confid] = PVE.Parser.printPropertyString(values, 'dirid');
        return params;
    },

    setSharedfiles: function (confid, data) {
        var me = this;
        me.confid = confid;
        me.virtiofs = data;
        me.setValues(me.virtiofs);
    },
    initComponent: function () {
        let me = this;

        me.nodename = me.pveSelNode.data.node;
        if (!me.nodename) {
            throw 'no node name specified';
        }
        me.items = [
            {
                xtype: 'pveDirMapSelector',
                name: 'dirid',
                fieldLabel: gettext('Directory ID'),
                emptyText: gettext('Mapping ID'),
                nodename: me.nodename,
                allowBlank: false,
            },
            {
                xtype: 'displayfield',
                userCls: 'pmx-hint',
                value: gettext(
                    'Directory Mappings can be managed under Datacenter -> Directory Mappings',
                ),
            },
        ];
        me.advancedItems = [
            {
                xtype: 'proxmoxKVComboBox',
                name: 'cache',
                fieldLabel: gettext('Cache'),
                value: '__default__',
                deleteDefaultValue: false,
                comboItems: [
                    ['__default__', Proxmox.Utils.defaultText + ' (auto)'],
                    ['auto', 'auto'],
                    ['always', 'always'],
                    ['metadata', 'metadata'],
                    ['never', 'never'],
                ],
            },
            {
                xtype: 'proxmoxcheckbox',
                name: 'expose-xattr',
                fieldLabel: gettext('xattr Support'),
                boxLabel: gettext('Enable support for extended attributes.'),
            },
            {
                xtype: 'proxmoxcheckbox',
                name: 'expose-acl',
                fieldLabel: gettext('POSIX ACLs'),
                boxLabel: gettext('Implies xattr support.'),
                listeners: {
                    change: function (f, value) {
                        let xattr = me.down('field[name=expose-xattr]');
                        xattr.setDisabled(value);
                        xattr.setValue(value);
                    },
                },
            },
            {
                xtype: 'proxmoxcheckbox',
                name: 'direct-io',
                fieldLabel: gettext('Allow Direct IO'),
            },
        ];

        me.virtiofs = {};
        me.confid = 'virtiofs0';
        me.callParent();
    },
});

Ext.define('PVE.qemu.VirtiofsEdit', {
    extend: 'Proxmox.window.Edit',

    subject: gettext('Virtiofs Filesystem Passthrough'),
    width: 450,

    initComponent: function () {
        var me = this;

        me.isCreate = !me.confid;

        var ipanel = Ext.create('PVE.qemu.VirtiofsInputPanel', {
            confid: me.confid,
            pveSelNode: me.pveSelNode,
            isCreate: me.isCreate,
        });

        Ext.applyIf(me, {
            items: ipanel,
        });

        me.callParent();

        me.load({
            success: function (response) {
                me.conf = response.result.data;
                var i, confid;
                if (!me.isCreate) {
                    let value = me.conf[me.confid];
                    let virtiofs = PVE.Parser.parsePropertyString(value, 'dirid');
                    if (!virtiofs) {
                        Ext.Msg.alert(gettext('Error'), 'Unable to parse virtiofs options');
                        me.close();
                        return;
                    }
                    ipanel.setSharedfiles(me.confid, virtiofs);
                } else {
                    for (i = 0; i < PVE.Utils.hardware_counts.virtiofs; i++) {
                        confid = 'virtiofs' + i.toString();
                        if (!Ext.isDefined(me.conf[confid])) {
                            me.confid = confid;
                            break;
                        }
                    }
                    ipanel.setSharedfiles(me.confid, {});
                }
            },
        });
    },
});
