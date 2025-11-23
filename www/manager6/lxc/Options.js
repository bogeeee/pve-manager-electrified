Ext.define('PVE.lxc.Options', {
    extend: 'Proxmox.grid.PendingObjectGrid',
    alias: ['widget.pveLxcOptions'],

    onlineHelp: 'pct_options',

    initComponent: function () {
        var me = this;

        var nodename = me.pveSelNode.data.node;
        if (!nodename) {
            throw 'no node name specified';
        }

        var vmid = me.pveSelNode.data.vmid;
        if (!vmid) {
            throw 'no VM ID specified';
        }

        var caps = Ext.state.Manager.get('GuiCap');

        var rows = {
            onboot: {
                header: gettext('Start at boot'),
                defaultValue: '',
                renderer: Proxmox.Utils.format_boolean,
                editor: caps.vms['VM.Config.Options']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Start at boot'),
                          items: {
                              xtype: 'proxmoxcheckbox',
                              name: 'onboot',
                              uncheckedValue: 0,
                              defaultValue: 0,
                              fieldLabel: gettext('Start at boot'),
                          },
                      }
                    : undefined,
            },
            startup: {
                header: gettext('Start/Shutdown order'),
                defaultValue: '',
                renderer: PVE.Utils.render_kvm_startup,
                editor:
                    caps.vms['VM.Config.Options'] && caps.nodes['Sys.Modify']
                        ? {
                              xtype: 'pveWindowStartupEdit',
                              onlineHelp: 'pct_startup_and_shutdown',
                          }
                        : undefined,
            },
            ostype: {
                header: gettext('OS Type'),
                defaultValue: Proxmox.Utils.unknownText,
            },
            arch: {
                header: gettext('Architecture'),
                defaultValue: Proxmox.Utils.unknownText,
            },
            console: {
                header: '/dev/console',
                defaultValue: 1,
                renderer: Proxmox.Utils.format_enabled_toggle,
                editor: caps.vms['VM.Config.Options']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: '/dev/console',
                          items: {
                              xtype: 'proxmoxcheckbox',
                              name: 'console',
                              uncheckedValue: 0,
                              defaultValue: 1,
                              deleteDefaultValue: true,
                              checked: true,
                              fieldLabel: '/dev/console',
                          },
                      }
                    : undefined,
            },
            tty: {
                header: gettext('TTY count'),
                defaultValue: 2,
                editor: caps.vms['VM.Config.Options']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('TTY count'),
                          items: {
                              xtype: 'proxmoxintegerfield',
                              name: 'tty',
                              minValue: 0,
                              maxValue: 6,
                              fieldLabel: gettext('TTY count'),
                              emptyText: gettext('Default'),
                              deleteEmpty: true,
                          },
                      }
                    : undefined,
            },
            cmode: {
                header: gettext('Console mode'),
                defaultValue: 'tty',
                editor: caps.vms['VM.Config.Options']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Console mode'),
                          items: {
                              xtype: 'proxmoxKVComboBox',
                              name: 'cmode',
                              deleteEmpty: true,
                              value: '__default__',
                              comboItems: [
                                  ['__default__', Proxmox.Utils.defaultText + ' (tty)'],
                                  ['tty', '/dev/tty[X]'],
                                  ['console', '/dev/console'],
                                  ['shell', 'shell'],
                              ],
                              fieldLabel: gettext('Console mode'),
                          },
                      }
                    : undefined,
            },
            protection: {
                header: gettext('Protection'),
                defaultValue: false,
                renderer: Proxmox.Utils.format_boolean,
                editor: caps.vms['VM.Config.Options']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Protection'),
                          items: {
                              xtype: 'proxmoxcheckbox',
                              name: 'protection',
                              uncheckedValue: 0,
                              defaultValue: 0,
                              deleteDefaultValue: true,
                              fieldLabel: gettext('Enabled'),
                          },
                      }
                    : undefined,
            },
            unprivileged: {
                header: gettext('Unprivileged container'),
                renderer: Proxmox.Utils.format_boolean,
                defaultValue: 0,
            },
            features: {
                header: gettext('Features'),
                defaultValue: Proxmox.Utils.noneText,
                editor: 'PVE.lxc.FeaturesEdit',
            },
            hookscript: {
                header: gettext('Hookscript'),
                renderer: Ext.htmlEncode,
            },
            entrypoint: {
                header: gettext('Entrypoint'),
                defaultValue: '/sbin/init',
                renderer: Ext.htmlEncode,
                editor: caps.vms['VM.Config.Options']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Entrypoint Init Command'),
                          defaultFocus: undefined,
                          items: [
                              {
                                  xtype: 'proxmoxtextfield',
                                  name: 'entrypoint',
                                  deleteEmpty: true,
                                  emptyText: '/sbin/init',
                              },

                              {
                                  xtype: 'displayfield',
                                  reference: 'emptyWarning',
                                  userCls: 'pmx-hint',
                                  value: gettext(
                                      'Changing the entrypoint command can lead to start failure!',
                                  ),
                              },
                          ],
                      }
                    : undefined,
            },
            env: {
                header: gettext('Environment'),
                renderer: (v) => (v ? Ext.htmlEncode(v.replaceAll(/\0+/g, ' ')) : null),
                defaultValue: Proxmox.Utils.noneText,
                editor: 'PVE.lxc.EnvEdit',
            },
        };

        var baseurl = 'nodes/' + nodename + '/lxc/' + vmid + '/config';

        var sm = Ext.create('Ext.selection.RowModel', {});

        var edit_btn = new Proxmox.button.Button({
            text: gettext('Edit'),
            disabled: true,
            selModel: sm,
            enableFn: function (rec) {
                var rowdef = rows[rec.data.key];
                return !!rowdef.editor;
            },
            handler: function () {
                me.run_editor();
            },
        });

        var revert_btn = new PVE.button.PendingRevert();

        var set_button_status = function () {
            let button_sm = me.getSelectionModel();
            let rec = button_sm.getSelection()[0];

            if (!rec) {
                edit_btn.disable();
                return;
            }

            var key = rec.data.key;
            var pending = rec.data.delete || me.hasPendingChanges(key);
            var rowdef = rows[key];

            if (key === 'features') {
                let unprivileged = me.getStore().getById('unprivileged').data.value;
                let root = Proxmox.UserName === 'root@pam';
                let vmalloc = caps.vms['VM.Allocate'];
                edit_btn.setDisabled(!(root || (vmalloc && unprivileged)));
            } else {
                edit_btn.setDisabled(!rowdef.editor);
            }

            revert_btn.setDisabled(!pending);
        };

        Ext.apply(me, {
            url: '/api2/json/nodes/' + nodename + '/lxc/' + vmid + '/pending',
            selModel: sm,
            interval: 5000,
            tbar: [edit_btn, revert_btn],
            rows: rows,
            editorConfig: {
                url: '/api2/extjs/' + baseurl,
            },
            listeners: {
                itemdblclick: me.run_editor,
                selectionchange: set_button_status,
            },
        });

        me.callParent();

        me.on('activate', me.rstore.startUpdate);
        me.on('destroy', me.rstore.stopUpdate);
        me.on('deactivate', me.rstore.stopUpdate);

        me.mon(me.getStore(), 'datachanged', function () {
            set_button_status();
        });
    },
});
