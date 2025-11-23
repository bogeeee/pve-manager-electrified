Ext.define('PVE.qemu.Options', {
    extend: 'Proxmox.grid.PendingObjectGrid',
    alias: ['widget.PVE.qemu.Options'],

    onlineHelp: 'qm_options',

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
            name: {
                required: true,
                defaultValue: me.pveSelNode.data.name,
                header: gettext('Name'),
                editor: caps.vms['VM.Config.Options']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Name'),
                          items: {
                              xtype: 'inputpanel',
                              items: {
                                  xtype: 'textfield',
                                  name: 'name',
                                  vtype: 'DnsName',
                                  value: '',
                                  fieldLabel: gettext('Name'),
                                  allowBlank: true,
                              },
                              onGetValues: function (values) {
                                  var params = values;
                                  if (
                                      values.name === undefined ||
                                      values.name === null ||
                                      values.name === ''
                                  ) {
                                      params = { delete: 'name' };
                                  }
                                  return params;
                              },
                          },
                      }
                    : undefined,
            },
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
                              deleteDefaultValue: true,
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
                              onlineHelp: 'qm_startup_and_shutdown',
                          }
                        : undefined,
            },
            ostype: {
                header: gettext('OS Type'),
                editor: caps.vms['VM.Config.Options'] ? 'PVE.qemu.OSTypeEdit' : undefined,
                renderer: PVE.Utils.render_kvm_ostype,
                defaultValue: 'other',
            },
            bootdisk: {
                visible: false,
            },
            boot: {
                header: gettext('Boot Order'),
                defaultValue: 'cdn',
                editor: caps.vms['VM.Config.Disk'] ? 'PVE.qemu.BootOrderEdit' : undefined,
                multiKey: ['boot', 'bootdisk'],
                renderer: function (order, metaData, record, rowIndex, colIndex, store, pending) {
                    if (/^\s*$/.test(order)) {
                        return gettext('(No boot device selected)');
                    }
                    let boot = PVE.Parser.parsePropertyString(order, 'legacy');
                    if (boot.order) {
                        let list = boot.order.split(';');
                        let ret = '';
                        list.forEach((dev) => {
                            if (ret) {
                                ret += ', ';
                            }
                            ret += dev;
                        });
                        return ret;
                    }

                    // legacy style and fallback
                    let i;
                    var text = '';
                    var bootdisk = me.getObjectValue('bootdisk', undefined, pending);
                    order = boot.legacy || 'cdn';
                    for (i = 0; i < order.length; i++) {
                        if (text) {
                            text += ', ';
                        }
                        let sel = order.substring(i, i + 1);
                        if (sel === 'c') {
                            if (bootdisk) {
                                text += bootdisk;
                            } else {
                                text += gettext('first disk');
                            }
                        } else if (sel === 'n') {
                            text += gettext('any net');
                        } else if (sel === 'a') {
                            text += gettext('Floppy');
                        } else if (sel === 'd') {
                            text += gettext('any CD-ROM');
                        } else {
                            text += sel;
                        }
                    }
                    return text;
                },
            },
            tablet: {
                header: gettext('Use tablet for pointer'),
                defaultValue: true,
                renderer: Proxmox.Utils.format_boolean,
                editor: caps.vms['VM.Config.HWType']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Use tablet for pointer'),
                          items: {
                              xtype: 'proxmoxcheckbox',
                              name: 'tablet',
                              checked: true,
                              uncheckedValue: 0,
                              defaultValue: 1,
                              deleteDefaultValue: true,
                              fieldLabel: gettext('Enabled'),
                          },
                      }
                    : undefined,
            },
            hotplug: {
                header: gettext('Hotplug'),
                defaultValue: 'disk,network,usb',
                renderer: PVE.Utils.render_hotplug_features,
                editor: caps.vms['VM.Config.HWType']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Hotplug'),
                          items: {
                              xtype: 'pveHotplugFeatureSelector',
                              name: 'hotplug',
                              value: '',
                              multiSelect: true,
                              fieldLabel: gettext('Hotplug'),
                              allowBlank: true,
                          },
                      }
                    : undefined,
            },
            acpi: {
                header: gettext('ACPI support'),
                defaultValue: true,
                renderer: Proxmox.Utils.format_boolean,
                editor: caps.vms['VM.Config.HWType']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('ACPI support'),
                          items: {
                              xtype: 'proxmoxcheckbox',
                              name: 'acpi',
                              checked: true,
                              uncheckedValue: 0,
                              defaultValue: 1,
                              deleteDefaultValue: true,
                              fieldLabel: gettext('Enabled'),
                          },
                      }
                    : undefined,
            },
            kvm: {
                header: gettext('KVM hardware virtualization'),
                defaultValue: true,
                renderer: Proxmox.Utils.format_boolean,
                editor: caps.vms['VM.Config.HWType']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('KVM hardware virtualization'),
                          items: {
                              xtype: 'proxmoxcheckbox',
                              name: 'kvm',
                              checked: true,
                              uncheckedValue: 0,
                              defaultValue: 1,
                              deleteDefaultValue: true,
                              fieldLabel: gettext('Enabled'),
                          },
                      }
                    : undefined,
            },
            freeze: {
                header: gettext('Freeze CPU at startup'),
                defaultValue: false,
                renderer: Proxmox.Utils.format_boolean,
                editor: caps.vms['VM.PowerMgmt']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Freeze CPU at startup'),
                          items: {
                              xtype: 'proxmoxcheckbox',
                              name: 'freeze',
                              uncheckedValue: 0,
                              defaultValue: 0,
                              deleteDefaultValue: true,
                              labelWidth: 140,
                              fieldLabel: gettext('Freeze CPU at startup'),
                          },
                      }
                    : undefined,
            },
            localtime: {
                header: gettext('Use local time for RTC'),
                defaultValue: '__default__',
                renderer: PVE.Utils.render_localtime,
                editor: caps.vms['VM.Config.Options']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Use local time for RTC'),
                          width: 400,
                          items: {
                              xtype: 'proxmoxKVComboBox',
                              name: 'localtime',
                              value: '__default__',
                              comboItems: [
                                  ['__default__', PVE.Utils.render_localtime('__default__')],
                                  [1, PVE.Utils.render_localtime(1)],
                                  [0, PVE.Utils.render_localtime(0)],
                              ],
                              labelWidth: 140,
                              fieldLabel: gettext('Use local time for RTC'),
                          },
                      }
                    : undefined,
            },
            startdate: {
                header: gettext('RTC start date'),
                defaultValue: 'now',
                editor: caps.vms['VM.Config.Options']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('RTC start date'),
                          items: {
                              xtype: 'proxmoxtextfield',
                              name: 'startdate',
                              deleteEmpty: true,
                              value: 'now',
                              fieldLabel: gettext('RTC start date'),
                              vtype: 'QemuStartDate',
                              allowBlank: true,
                          },
                      }
                    : undefined,
            },
            smbios1: {
                header: gettext('SMBIOS settings (type1)'),
                defaultValue: '',
                renderer: Ext.String.htmlEncode,
                editor: caps.vms['VM.Config.HWType'] ? 'PVE.qemu.Smbios1Edit' : undefined,
            },
            agent: {
                header: 'QEMU Guest Agent',
                defaultValue: false,
                renderer: PVE.Utils.render_qga_features,
                editor: caps.vms['VM.Config.Options']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Qemu Agent'),
                          width: 350,
                          onlineHelp: 'qm_qemu_agent',
                          items: {
                              xtype: 'pveAgentFeatureSelector',
                              name: 'agent',
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
            spice_enhancements: {
                header: gettext('Spice Enhancements'),
                defaultValue: false,
                renderer: PVE.Utils.render_spice_enhancements,
                editor: caps.vms['VM.Config.Options']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Spice Enhancements'),
                          onlineHelp: 'qm_spice_enhancements',
                          items: {
                              xtype: 'pveSpiceEnhancementSelector',
                              name: 'spice_enhancements',
                          },
                      }
                    : undefined,
            },
            vmstatestorage: {
                header: gettext('VM State storage'),
                defaultValue: '',
                renderer: (val) => val || gettext('Automatic'),
                editor: caps.vms['VM.Config.Options']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('VM State storage'),
                          onlineHelp: 'qm_vmstatestorage',
                          width: 350,
                          items: {
                              xtype: 'pveStorageSelector',
                              storageContent: 'images',
                              allowBlank: true,
                              emptyText: gettext("Automatic (Storage used by the VM, or 'local')"),
                              autoSelect: false,
                              deleteEmpty: true,
                              skipEmptyText: true,
                              nodename: nodename,
                              name: 'vmstatestorage',
                          },
                      }
                    : undefined,
            },
            'amd-sev': {
                header: gettext('AMD SEV'),
                editor: caps.vms['VM.Config.HWType'] ? 'PVE.qemu.SevEdit' : undefined,
                defaultValue: Proxmox.Utils.defaultText + ' (' + Proxmox.Utils.disabledText + ')',
                renderer: function (value, metaData, record, ri, ci, store, pending) {
                    let amd_sev = PVE.Parser.parsePropertyString(value, 'type');
                    if (amd_sev.type === 'std') {
                        return 'AMD SEV (' + value + ')';
                    }
                    if (amd_sev.type === 'es') {
                        return 'AMD SEV-ES (' + value + ')';
                    }
                    if (amd_sev.type === 'snp') {
                        return 'AMD SEV-SNP (' + value + ')';
                    }
                    return value;
                },
            },
            'intel-tdx': {
                header: gettext('Intel TDX'),
                editor: caps.vms['VM.Config.HWType'] ? 'PVE.qemu.TdxEdit' : undefined,
                defaultValue: Proxmox.Utils.defaultText + ' (' + Proxmox.Utils.disabledText + ')',
                renderer: function (value, metaData, record, ri, ci, store, pending) {
                    let intel_tdx = PVE.Parser.parsePropertyString(value, 'type');
                    if (intel_tdx.type === 'tdx') {
                        return 'Intel (' + value + ')';
                    }
                    return value;
                },
            },
            hookscript: {
                header: gettext('Hookscript'),
            },
        };

        var baseurl = 'nodes/' + nodename + '/qemu/' + vmid + '/config';

        var edit_btn = new Ext.Button({
            text: gettext('Edit'),
            disabled: true,
            handler: function () {
                me.run_editor();
            },
        });

        var revert_btn = new PVE.button.PendingRevert();

        var set_button_status = function () {
            var sm = me.getSelectionModel();
            var rec = sm.getSelection()[0];

            if (!rec) {
                edit_btn.disable();
                return;
            }

            var key = rec.data.key;
            var pending = rec.data.delete || me.hasPendingChanges(key);
            var rowdef = rows[key];

            edit_btn.setDisabled(!rowdef.editor);
            revert_btn.setDisabled(!pending);
        };

        Ext.apply(me, {
            url: '/api2/json/nodes/' + nodename + '/qemu/' + vmid + '/pending',
            interval: 5000,
            cwidth1: 250,
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

        me.on('activate', () => me.rstore.startUpdate());
        me.on('destroy', () => me.rstore.stopUpdate());
        me.on('deactivate', () => me.rstore.stopUpdate());

        me.mon(me.getStore(), 'datachanged', function () {
            set_button_status();
        });
    },
});
